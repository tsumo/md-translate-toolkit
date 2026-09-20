/**
 * The status dialog. A click on a pill opens the dialog next to it. CSS anchor positioning places it, so the
 * script only names the anchor. Save posts the form with `fetch`, so the page keeps its scroll position and an
 * error shows in the dialog. The dev server reloads the page after it writes the manifest.
 */
import { ANCHOR_PREFIX, ATTR_ORIGINAL_PATH, ATTR_STATUSES, DIALOG_ID, PILL_CLASS } from "../dom-names.js";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

function hiddenInput(name: string, value: string): HTMLInputElement {
  return element("input", { type: "hidden", name, value });
}

/** Builds the dialog and its form. It returns the dialog and the parts the handlers need. */
function buildDialog(originalPath: string, statuses: string[]) {
  const title = element("strong", { id: "status-dialog-title" });
  const statusSelect = element(
    "select",
    { name: "status" },
    ...statuses.map((status) => element("option", { value: status, textContent: status })),
  );
  const commentInput = element("input", { type: "text", name: "comment", placeholder: "comment" });
  const error = element("p", { id: "status-error", className: "status-error", hidden: true });
  const cancel = element("button", { type: "button", id: "status-cancel", textContent: "Cancel" });
  const save = element("button", { type: "submit", textContent: "Save" });
  const blockInput = hiddenInput("block", "");
  const form = element(
    "form",
    { id: "status-form" },
    title,
    hiddenInput("path", originalPath),
    blockInput,
    statusSelect,
    commentInput,
    error,
    element("div", { className: "actions" }, cancel, save),
  );
  const dialog = element("dialog", { id: DIALOG_ID, className: "status-dialog" }, form);
  return { dialog, form, title, blockInput, statusSelect, commentInput, error, cancel };
}

export function startStatusDialog(): void {
  const columns = document.querySelector<HTMLElement>(`[${ATTR_ORIGINAL_PATH}]`);
  if (!columns) return;
  const originalPath = columns.getAttribute(ATTR_ORIGINAL_PATH) ?? "";
  const statuses = (columns.getAttribute(ATTR_STATUSES) ?? "").split(" ").filter(Boolean);

  const { dialog, form, title, blockInput, statusSelect, commentInput, error, cancel } = buildDialog(
    originalPath,
    statuses,
  );
  document.body.append(dialog);

  const syncCommentRequired = () => {
    commentInput.required = statusSelect.value === "needs-attention";
  };
  const close = () => dialog.close();

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
  cancel.addEventListener("click", close);
  statusSelect.addEventListener("change", syncCommentRequired);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = new URLSearchParams(new FormData(form) as unknown as Record<string, string>);
    const response = await fetch("/api/status", { method: "POST", body });
    if (!response.ok) {
      error.textContent = await response.text();
      error.hidden = false;
      return;
    }
    close();
  });
}
