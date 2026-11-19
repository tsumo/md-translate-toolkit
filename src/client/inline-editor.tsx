/**
 * The inline block editor. A click on a translation cell fetches the block's raw Markdown source and its kind
 * from the dev server, then replaces the cell's content with a plain-text Markdown field. The status select
 * opens on the block's current status and the comment field on its existing comment. Save (or Ctrl/Cmd+Enter)
 * checks the submission rule with the shared validator and posts text, status, and comment. The server checks
 * the rule again and any refusal shows inside the editor. Escape or Cancel puts the rendered block back and
 * writes nothing. Only one editor is open at a time. While one is open, clicks on other cells are ignored,
 * so an open edit is never silently discarded.
 */
import {
  ATTR_BLOCK,
  ATTR_COMMENT,
  ATTR_ORIGINAL_PATH,
  ATTR_STATUS,
  ATTR_STATUSES,
  CELL_CLASS,
  PILL_CLASS,
} from "../dom-names.js";
import { prefillForBlock } from "../placeholder.js";
import { validateBlockText } from "../validate-block-text.js";
import { renderFragment } from "./fragment.js";

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
  /** The block's raw Markdown source. `prefillForBlock` decides the field's starting text. */
  text: string;
  /** The statuses the select offers, with `currentStatus` preselected. */
  statuses: string[];
  currentStatus: string;
  currentComment: string;
  onDismiss: () => void;
  onSend: (text: string, status: string, comment: string) => Promise<string | null>;
}

/**
 * Builds the editor that replaces the cell's content. Cancel calls `onDismiss`. Save and Ctrl/Cmd+Enter send
 * through `onSend`, which returns the server's rejection reason to show in the editor, or null on success.
 */
function buildEditor(props: EditorProps): DocumentFragment {
  let field!: HTMLTextAreaElement;
  let statusSelect!: HTMLSelectElement;
  let commentInput!: HTMLInputElement;
  let error!: HTMLParagraphElement;

  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
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
    // Saved. No DOM change: the live-reload stream refreshes the page.
    else error.hidden = true;
  };

  return renderFragment(
    <form
      className="inline-editor"
      onSubmit={(event: Event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        value={prefillForBlock(props.text)}
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
      />
      <select
        aria-label="Status"
        value={props.currentStatus}
        ref={(el: HTMLSelectElement) => {
          statusSelect = el;
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
        ref={(el: HTMLInputElement) => {
          commentInput = el;
        }}
      />
      <p
        className="status-error"
        hidden
        ref={(el: HTMLParagraphElement) => {
          error = el;
        }}
      />
      <div className="actions">
        <button type="button" onClick={props.onDismiss}>
          Cancel
        </button>
        <button type="submit">Save</button>
      </div>
    </form>,
  );
}

export function startInlineEditor(): void {
  const columns = document.querySelector<HTMLElement>(`[${ATTR_ORIGINAL_PATH}]`);
  if (!columns) return;
  const originalPath = columns.getAttribute(ATTR_ORIGINAL_PATH) ?? "";
  const statuses = (columns.getAttribute(ATTR_STATUSES) ?? "").split(" ").filter(Boolean);

  // The dismiss of the open editor, if any. Claimed before the fetch, so a second click during the
  // request cannot open a second editor.
  let dismissOpen: (() => void) | null = null;

  async function openEditor(cell: HTMLElement, block: string): Promise<void> {
    const rendered = renderedContent(cell);
    const dismiss = () => {
      cell.replaceChildren(...rendered);
      dismissOpen = null;
      document.removeEventListener("keydown", onKeydown);
    };
    // Escape dismisses from anywhere on the page, the way the status dialog's Escape does.
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
      // The select and the comment field prefill from the pill the page rendered.
      const pill = document.querySelector<HTMLElement>(`.${PILL_CLASS}[${ATTR_BLOCK}="${block}"]`);
      const currentStatus = pill?.getAttribute(ATTR_STATUS) ?? "";
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
        buildEditor({ block, kind, text, statuses, currentStatus, currentComment, onDismiss: dismiss, onSend: send }),
      );
      cell.querySelector("textarea")?.focus();
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
