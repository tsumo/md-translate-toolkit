/**
 * The status dialog. A click on a pill opens the dialog next to it. CSS anchor positioning places it, so the
 * script only names the anchor. Save posts the form with `fetch`, so the page keeps its scroll position and an
 * error shows in the dialog. The dev server reloads the page after it writes the manifest.
 */
import { ANCHOR_PREFIX, ATTR_ORIGINAL_PATH, ATTR_STATUSES, DIALOG_ID, PILL_CLASS } from "../dom-names.js";
import { renderFragment } from "./fragment.js";

export function startStatusDialog(): void {
  const columns = document.querySelector<HTMLElement>(`[${ATTR_ORIGINAL_PATH}]`);
  if (!columns) return;
  const originalPath = columns.getAttribute(ATTR_ORIGINAL_PATH) ?? "";
  const statuses = (columns.getAttribute(ATTR_STATUSES) ?? "").split(" ").filter(Boolean);

  // The parts the handlers need, filled in by the refs of the markup below.
  let title!: HTMLElement;
  let form!: HTMLFormElement;
  let blockInput!: HTMLInputElement;
  let statusSelect!: HTMLSelectElement;
  let commentInput!: HTMLInputElement;
  let error!: HTMLParagraphElement;
  let dialog!: HTMLDialogElement;

  const syncCommentRequired = () => {
    commentInput.required = statusSelect.value === "needs-attention";
  };
  const close = () => dialog.close();

  document.body.append(
    renderFragment(
      <dialog
        id={DIALOG_ID}
        className="status-dialog"
        ref={(el: HTMLDialogElement) => {
          dialog = el;
        }}
      >
        <form
          id="status-form"
          ref={(el: HTMLFormElement) => {
            form = el;
          }}
          onSubmit={async (event) => {
            event.preventDefault();
            const body = new URLSearchParams(new FormData(form) as unknown as Record<string, string>);
            const response = await fetch("/api/status", { method: "POST", body });
            if (!response.ok) {
              error.textContent = await response.text();
              error.hidden = false;
              return;
            }
            close();
          }}
        >
          <strong
            id="status-dialog-title"
            ref={(el: HTMLElement) => {
              title = el;
            }}
          />
          <input type="hidden" name="path" value={originalPath} />
          <input
            type="hidden"
            name="block"
            ref={(el: HTMLInputElement) => {
              blockInput = el;
            }}
          />
          <select
            name="status"
            ref={(el: HTMLSelectElement) => {
              statusSelect = el;
            }}
          >
            {statuses.map((status) => (
              <option value={status}>{status}</option>
            ))}
          </select>
          <input
            type="text"
            name="comment"
            placeholder="comment"
            ref={(el: HTMLInputElement) => {
              commentInput = el;
            }}
          />
          <p
            id="status-error"
            className="status-error"
            hidden
            ref={(el: HTMLParagraphElement) => {
              error = el;
            }}
          />
          <div className="actions">
            <button type="button" id="status-cancel" onClick={close}>
              Cancel
            </button>
            <button type="submit">Save</button>
          </div>
        </form>
      </dialog>,
    ),
  );

  document.addEventListener("click", (event) => {
    const target = event.target as Element;
    const clicked = target.closest<HTMLElement>(`.${PILL_CLASS}`);
    if (!clicked) {
      if (dialog.open && !dialog.contains(target)) close();
      return;
    }
    const block = clicked.dataset.block ?? "";
    blockInput.value = block;
    statusSelect.value = clicked.dataset.status ?? "";
    commentInput.value = clicked.dataset.comment ?? "";
    title.textContent = `Block ${block}`;
    error.hidden = true;
    syncCommentRequired();
    dialog.style.setProperty("position-anchor", `${ANCHOR_PREFIX}${block}`);
    if (!dialog.open) dialog.show();
    statusSelect.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.open) close();
  });
  statusSelect.addEventListener("change", syncCommentRequired);
}
