/**
 * The inline block editor. A click on a translation cell fetches the block's raw Markdown source and its kind
 * from the dev server, then replaces the cell's content with the editor card: a plain-text Markdown field
 * prefilled per the placeholder rule, the status select, and the comment field. Save (or Ctrl/Cmd+Enter)
 * checks the submission rule with the shared validator and posts text, status, and comment. The server checks
 * the rule again and a rejection replaces the keyboard hint line until the next edit. The comment field is
 * browser-required while needs-attention is selected, and Save wears the selected status's color. Escape or
 * Cancel dismisses it and writes nothing. Only one editor is open at a time: while one is open, clicks on
 * other cells are ignored, so an open edit is never silently discarded. On a phone the block's original is
 * restated as a muted strip above the field, cloned from the row's original cell while the cell and the pill
 * hide; on a desktop the strip stays display:none beside the visible original panel.
 */
import {
  ATTR_BLOCK,
  ATTR_COMMENT,
  ATTR_ORIGINAL_PATH,
  ATTR_STATUS,
  ATTR_STATUSES,
  BLOCK_ROW_CLASS,
  CELL_CLASS,
  ORIG_CLASS,
  PILL_CLASS,
} from "../dom-names.js";
import { prefillForBlock } from "../placeholder.js";
import type { BlockStatus } from "../types.js";
import { validateBlockText } from "../validate-block-text.js";
import { renderFragment } from "./fragment.js";

/** Mark on a block row while its editor is open; the phone stylesheet turns the row into the editor box. */
const EDITING_CLASS = "editing";

/** The rendered block of each cell that an editor or an error replaced, so dismissal can put it back. */
const renderedByCell = new WeakMap<HTMLElement, Node[]>();

function renderedContent(cell: HTMLElement): Node[] {
  let rendered = renderedByCell.get(cell);
  if (!rendered) {
    rendered = [...cell.childNodes];
    renderedByCell.set(cell, rendered);
  }
  return rendered;
}

/** What one open editor is built from, and where a submission goes. */
interface EditorProps {
  block: string;
  kind: string;
  /** The block's raw Markdown source. `prefillForBlock` decides the field's starting text from the status. */
  text: string;
  /** The original cell's rendered HTML, restated as the muted reference strip above the field on a phone. */
  originalHtml: string;
  /** The statuses the select offers, with `currentStatus` preselected. */
  statuses: string[];
  currentStatus: BlockStatus;
  currentComment: string;
  onDismiss: () => void;
  onSend: (text: string, status: string, comment: string) => Promise<string | null>;
}

/**
 * Builds the editor that replaces the cell's content. Cancel calls `onDismiss`. Save and Ctrl/Cmd+Enter send
 * through `onSend`, which returns the server's rejection reason to show in place of the keyboard hint, or
 * null on success.
 */
function buildEditor(props: EditorProps): DocumentFragment {
  let field!: HTMLTextAreaElement;
  let statusSelect!: HTMLSelectElement;
  let commentInput!: HTMLInputElement;
  let save!: HTMLButtonElement;
  let hint!: HTMLParagraphElement;
  let error!: HTMLParagraphElement;

  // The keyboard hint and a rejection share one line: an error swaps in, the next edit swaps the hint back.
  const showError = (message: string) => {
    hint.hidden = true;
    error.textContent = message;
    error.hidden = false;
  };
  const restoreHint = () => {
    error.hidden = true;
    hint.hidden = false;
  };

  // The select drives the comment field's browser-required flag and Save's status color.
  const applyStatus = () => {
    commentInput.required = statusSelect.value === "needs-attention";
    save.className = `save status-${statusSelect.value}`;
  };

  const submit = async () => {
    // The client's own check of the shared submission rule, so an invalid edit never leaves the browser.
    const check = validateBlockText(field.value, props.kind);
    if (!check.ok) {
      showError(check.error);
      return;
    }
    const failure = await props.onSend(field.value, statusSelect.value, commentInput.value);
    if (failure) showError(failure);
    // Saved. Only the hint line comes back; the live-reload stream refreshes the page.
    else restoreHint();
  };

  return renderFragment(
    <form
      className="inline-editor"
      onSubmit={(event: Event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {props.originalHtml !== "" && (
        <div className="editor-orig" dangerouslySetInnerHTML={{ __html: props.originalHtml }} />
      )}
      <textarea
        value={prefillForBlock(props.text, props.currentStatus)}
        aria-label={`Block ${props.block}, ${props.kind}`}
        ref={(el: HTMLTextAreaElement) => {
          field = el;
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        onInput={restoreHint}
      />
      <div className="editor-fields">
        <select
          aria-label="Status"
          value={props.currentStatus}
          ref={(el: HTMLSelectElement) => {
            statusSelect = el;
          }}
          onChange={() => {
            applyStatus();
            restoreHint();
          }}
        >
          {props.statuses.map((status) => (
            <option value={status}>{status}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="comment"
          value={props.currentComment}
          required={props.currentStatus === "needs-attention"}
          ref={(el: HTMLInputElement) => {
            commentInput = el;
          }}
          onInput={restoreHint}
        />
      </div>
      <div className="editor-foot">
        <p
          className="kbd-hint"
          ref={(el: HTMLParagraphElement) => {
            hint = el;
          }}
        >
          Esc cancels · Ctrl/Cmd+Enter saves
        </p>
        <p
          className="status-error"
          hidden
          ref={(el: HTMLParagraphElement) => {
            error = el;
          }}
        />
        <div className="actions">
          <button type="button" className="cancel" onClick={props.onDismiss}>
            Cancel
          </button>
          <button
            type="submit"
            className={`save status-${props.currentStatus}`}
            ref={(el: HTMLButtonElement) => {
              save = el;
            }}
          >
            Save
          </button>
        </div>
      </div>
    </form>,
  );
}

export function startInlineEditor(): void {
  const docGrid = document.querySelector<HTMLElement>(`[${ATTR_ORIGINAL_PATH}]`);
  if (!docGrid) return;
  const originalPath = docGrid.getAttribute(ATTR_ORIGINAL_PATH) ?? "";
  const statuses = (docGrid.getAttribute(ATTR_STATUSES) ?? "").split(" ").filter(Boolean);

  // The dismiss of the open editor, if any. Claimed before the fetch, so a second click during the
  // request cannot open a second editor.
  let dismissOpen: (() => void) | null = null;

  async function openEditor(cell: HTMLElement, block: string): Promise<void> {
    const rendered = renderedContent(cell);
    const row = cell.closest(`.${BLOCK_ROW_CLASS}`);
    const dismiss = () => {
      cell.replaceChildren(...rendered);
      row?.classList.remove(EDITING_CLASS);
      dismissOpen = null;
      document.removeEventListener("keydown", onKeydown);
    };
    // Escape dismisses from anywhere on the page.
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    dismissOpen = dismiss;
    document.addEventListener("keydown", onKeydown);
    try {
      const response = await fetch(`/api/block?${new URLSearchParams({ path: originalPath, block })}`);
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(detail || `The server answered ${response.status}.`);
      }
      const { text, kind } = (await response.json()) as { text: string; kind: string };
      if (dismissOpen !== dismiss) return; // dismissed while the request was in flight
      // The select and the comment field prefill from the pill the page rendered. The attribute is
      // server-rendered from a real BlockStatus, so this is the DOM boundary where the type enters.
      const pill = document.querySelector<HTMLElement>(`.${PILL_CLASS}[${ATTR_BLOCK}="${block}"]`);
      const currentStatus = (pill?.getAttribute(ATTR_STATUS) ?? "untranslated") as BlockStatus;
      const currentComment = pill?.getAttribute(ATTR_COMMENT) ?? "";
      const send = async (edited: string, status: string, comment: string): Promise<string | null> => {
        try {
          const body = new URLSearchParams({ path: originalPath, block, text: edited, status, comment });
          const saveResponse = await fetch("/api/block", { method: "POST", body });
          if (dismissOpen !== dismiss) return null; // dismissed while the save was in flight
          if (!saveResponse.ok) {
            const detail = (await saveResponse.text()).trim();
            return detail || `The server answered ${saveResponse.status}.`;
          }
          return null;
        } catch (err) {
          if (dismissOpen !== dismiss) return null; // likewise: leave the restored cell alone
          return err instanceof Error ? err.message : String(err);
        }
      };
      cell.replaceChildren(
        buildEditor({
          block,
          kind,
          text,
          originalHtml: row?.querySelector<HTMLElement>(`.cell.${ORIG_CLASS}`)?.innerHTML ?? "",
          statuses,
          currentStatus,
          currentComment,
          onDismiss: dismiss,
          onSend: send,
        }),
      );
      // On a phone the row hides its original cell and pill, leaving the editor as the card's content.
      row?.classList.add(EDITING_CLASS);
      const textarea = cell.querySelector("textarea");
      if (textarea) {
        textarea.focus();
        // The caret starts after the prefilled text.
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      }
    } catch (err) {
      if (dismissOpen !== dismiss) return; // likewise: leave the restored cell alone
      const message = err instanceof Error ? err.message : String(err);
      cell.replaceChildren(renderFragment(<p className="status-error">{message}</p>));
      dismissOpen = null;
      document.removeEventListener("keydown", onKeydown);
    }
  }

  document.addEventListener("click", (event) => {
    const cell = (event.target as Element).closest<HTMLElement>(`.${CELL_CLASS}`);
    if (!cell || dismissOpen) return;
    void openEditor(cell, cell.getAttribute(ATTR_BLOCK) ?? "");
  });
}
