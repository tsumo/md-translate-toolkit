/**
 * The inline block editor. A click on a translation cell fetches the block's raw Markdown source and its kind
 * from the dev server, then replaces the cell's content with a plain-text Markdown field. Escape or Cancel
 * puts the rendered block back and writes nothing. Only one editor is open at a time: while one is open,
 * clicks on other cells are ignored, so an open edit is never silently discarded.
 */
import { ATTR_BLOCK, ATTR_ORIGINAL_PATH, CELL_CLASS } from "../dom-names.js";
import { prefillForBlock } from "../placeholder.js";
import { element } from "./element.js";

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

/** Builds the editor that replaces the cell's content. Cancel calls `onDismiss`. */
function buildEditor(block: string, kind: string, text: string, onDismiss: () => void): HTMLElement {
  const textarea = element("textarea", { value: prefillForBlock(text) });
  textarea.setAttribute("aria-label", `Block ${block}, ${kind}`);
  const cancel = element("button", { type: "button", textContent: "Cancel" });
  cancel.addEventListener("click", onDismiss);
  return element(
    "div",
    { className: "inline-editor" },
    textarea,
    element("div", { className: "actions" }, cancel),
  );
}

export function startInlineEditor(): void {
  const columns = document.querySelector<HTMLElement>(`[${ATTR_ORIGINAL_PATH}]`);
  if (!columns) return;
  const originalPath = columns.getAttribute(ATTR_ORIGINAL_PATH) ?? "";

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
      const editor = buildEditor(block, kind, text, dismiss);
      cell.replaceChildren(editor);
      editor.querySelector("textarea")?.focus();
    } catch (err) {
      if (dismissOpen !== dismiss) return; // likewise: leave the restored cell alone
      const message = err instanceof Error ? err.message : String(err);
      cell.replaceChildren(element("p", { className: "status-error", textContent: message }));
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
