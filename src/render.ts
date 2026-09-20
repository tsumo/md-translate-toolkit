/** HTML rendering for the dev server and the static build: blocks, the page shell, the document body, and the index. */
import { readFileSync } from "node:fs";
import type { Root as HastRoot } from "hast";
import type { Root, RootContent } from "mdast";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { ResolvedConfig } from "./config.js";
import { encodePathSegments, hrefForDoc } from "./paths.js";
import { isUntranslated, translationProgress } from "./split-blocks.js";
import { deriveFileStatus, VALID_BLOCK_STATUSES } from "./status.js";
import type { BlockEntry, ManifestEntry } from "./types.js";

const toHast = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeSlug);
const stringifyHast = unified().use(rehypeStringify, { allowDangerousHtml: true });

/**
 * Converts a document to HTML, one string per block. Heading IDs need the whole document, so this converts
 * the whole tree once and then splits the result into blocks.
 */
export function documentToBlockHtml(nodes: RootContent[]): string[] {
  const mdastRoot: Root = { type: "root", children: nodes };
  const hastRoot = toHast.runSync(mdastRoot) as HastRoot;
  // remark-rehype adds blank text nodes between blocks. Drop them, or the block indices shift.
  const blocks = hastRoot.children.filter((child) => child.type !== "text" || child.value.trim() !== "");
  return blocks.map((child) => stringifyHast.stringify({ type: "root", children: [child] }));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Page-level settings that differ between the dev server and the static build. */
export interface PageOptions {
  /** The `href` of the shared stylesheet. */
  stylesheetHref: string;
  /** HTML that follows the body, such as a live-reload script. */
  extraBodyHtml?: string;
}

/** The page shell around `bodyHtml`. */
export function pageWrapper(title: string, bodyHtml: string, options: PageOptions): string {
  const { stylesheetHref, extraBodyHtml = "" } = options;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${escapeHtml(stylesheetHref)}"></head>
<body>${bodyHtml}${extraBodyHtml}</body></html>`;
}

type Attribution = Pick<ResolvedConfig, "licenseName" | "licenseUrl">;

/** A GitHub link to `path` in `repo` at `commit`. */
function githubBlobUrl(repo: string, commit: string, path: string): string {
  return `https://github.com/${repo}/blob/${commit}/${encodePathSegments(path)}`;
}

function renderFooter(attribution: Attribution, entry?: ManifestEntry): string {
  const parts: string[] = [];

  if (entry) {
    const originalWorkUrl = `https://github.com/${entry.source_repo}`;
    const commitLink = `<a href="${githubBlobUrl(entry.source_repo, entry.source_commit, entry.original_path)}">view original at this commit</a>`;
    parts.push(`Translated from <a href="${originalWorkUrl}">${escapeHtml(entry.source_repo)}</a> (${commitLink})`);
  }

  if (attribution.licenseName && attribution.licenseUrl) {
    parts.push(`Licensed under <a href="${attribution.licenseUrl}">${escapeHtml(attribution.licenseName)}</a>`);
  }

  return parts.length > 0 ? `<footer><p>${parts.join(" — ")}.</p></footer>` : "";
}

/** The label of a status pill. It is the block number, and a flagged block also gets a "!". */
function pillLabel(index: number, block: BlockEntry): string {
  return block.status === "needs-attention" ? `${index}!` : String(index);
}

/** The hover text of a status pill: the status, and the comment if there is one. */
function pillTitle(block: BlockEntry): string {
  return block.status_comment ? `${block.status}: ${block.status_comment}` : block.status;
}

/**
 * The status pill of one block. It shows the block number, colored by status. A click opens the shared status
 * dialog. Only the dev server shows it, never the static build (ADR-016).
 */
function renderStatusPill(index: number, block: BlockEntry): string {
  const title = escapeHtml(pillTitle(block));
  return `<p class="block-index"><button type="button" class="status-pill status-${block.status}" data-block="${index}" data-status="${block.status}" data-comment="${escapeHtml(block.status_comment ?? "")}" style="anchor-name: --pill-${index}" title="${title}" aria-label="Block ${index}, ${title}">${pillLabel(index, block)}</button></p>`;
}

/** The one status dialog of a page. The script below fills it from the clicked pill. */
function renderStatusDialog(originalPath: string): string {
  const options = VALID_BLOCK_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join("");
  return `<dialog id="status-dialog" class="status-dialog">
    <form id="status-form">
      <strong id="status-dialog-title"></strong>
      <input type="hidden" name="path" value="${escapeHtml(originalPath)}">
      <input type="hidden" name="block" value="">
      <select name="status">${options}</select>
      <input type="text" name="comment" placeholder="comment">
      <p class="status-error" id="status-error" hidden></p>
      <div class="actions"><button type="button" id="status-cancel">Cancel</button><button type="submit">Save</button></div>
    </form>
  </dialog>`;
}

/**
 * The script of the status dialog. A click on a pill opens the dialog next to it. CSS anchor positioning places it, so the script only names the anchor. Save posts the form with
 * `fetch`, so the page keeps its scroll position and an error shows in the dialog. The dev server reloads the
 * page after it writes the manifest.
 */
const STATUS_DIALOG_SCRIPT = `<script>
  (() => {
    const dialog = document.getElementById("status-dialog");
    const form = document.getElementById("status-form");
    const error = document.getElementById("status-error");
    const comment = form.elements.comment;

    const syncCommentRequired = () => { comment.required = form.elements.status.value === "needs-attention"; };
    const close = () => dialog.close();

    document.addEventListener("click", (event) => {
      const clicked = event.target.closest(".status-pill");
      if (!clicked) {
        if (dialog.open && !dialog.contains(event.target)) close();
        return;
      }
      form.elements.block.value = clicked.dataset.block;
      form.elements.status.value = clicked.dataset.status;
      comment.value = clicked.dataset.comment;
      document.getElementById("status-dialog-title").textContent = "Block " + clicked.dataset.block;
      error.hidden = true;
      syncCommentRequired();
      dialog.style.positionAnchor = "--pill-" + clicked.dataset.block;
      if (!dialog.open) dialog.show();
      form.elements.status.focus();
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && dialog.open) close(); });
    document.getElementById("status-cancel").addEventListener("click", close);
    form.elements.status.addEventListener("change", syncCommentRequired);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await fetch("/api/status", { method: "POST", body: new URLSearchParams(new FormData(form)) });
      if (!response.ok) {
        error.textContent = await response.text();
        error.hidden = false;
        return;
      }
      close();
    });
  })();
</script>`;

/**
 * The body of a document page, with three columns: index, original, translation. The index column shows the
 * block number that `set-status --block` takes. In the dev server, the number is also the status button. `backHref` links back to the index. It is `/` for the dev
 * server and a relative path for the static build.
 */
export function renderDocumentBody(
  backHref: string,
  originalHtml: string[],
  translationHtml: string[],
  translationNodes: RootContent[],
  editable?: { originalPath: string; blocks: BlockEntry[] },
): string {
  const rowCount = Math.max(originalHtml.length, translationHtml.length);
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const node = translationNodes[i];
    const rightClass = node && isUntranslated(node) ? ' class="untranslated"' : "";
    const block = editable?.blocks[i];
    const indexCell =
      block && block.kind !== "thematicBreak" ? renderStatusPill(i, block) : `<p class="block-index">${i}</p>`;
    rows.push(
      `<div>${indexCell}</div>`,
      `<div>${originalHtml[i] ?? ""}</div>`,
      `<div${rightClass}>${translationHtml[i] ?? ""}</div>`,
    );
  }
  const dialog = editable ? renderStatusDialog(editable.originalPath) + STATUS_DIALOG_SCRIPT : "";
  return `<p><a href="${escapeHtml(backHref)}">&larr; all documents</a></p><div class="columns">${rows.join("")}</div>${dialog}`;
}

export function renderDocumentPage(
  entry: ManifestEntry,
  originalHtml: string[],
  translationNodes: RootContent[],
  backHref: string,
  attribution: Attribution,
  options: PageOptions,
  editable = false,
): string {
  const translationHtml = documentToBlockHtml(translationNodes);
  const editableInfo = editable ? { originalPath: entry.original_path, blocks: entry.blocks } : undefined;
  const body =
    renderDocumentBody(backHref, originalHtml, translationHtml, translationNodes, editableInfo) +
    renderFooter(attribution, entry);
  return pageWrapper(entry.original_path, body, options);
}

export function renderIndexPage(
  entries: ManifestEntry[],
  attribution: Attribution,
  options: PageOptions,
  staleness?: Map<string, boolean>,
): string {
  const items = entries
    .map((entry) => {
      const progress = translationProgress(readFileSync(entry.translation_path, "utf-8"));
      const stale = staleness?.get(entry.original_path) ?? false;
      return renderIndexItem(entry, progress, stale);
    })
    .join("");
  const body = `<h1>Claimed documents</h1><ul class="index">${items}</ul>${renderFooter(attribution)}`;
  return pageWrapper("Translations", body, options);
}

/** One index entry: link, status badge, progress, and flagged blocks. */
export function renderIndexItem(
  entry: ManifestEntry,
  progress: { translated: number; total: number },
  stale = false,
): string {
  const status = deriveFileStatus(entry.blocks, progress);
  const href = hrefForDoc(entry.original_path);

  const flagged = entry.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.status === "needs-attention");
  const flaggedList = flagged.length
    ? `<ul class="flagged">${flagged
        .map(({ block, index }) => `<li>block ${index}: ${escapeHtml(block.status_comment ?? "")}</li>`)
        .join("")}</ul>`
    : "";

  return `<li>
    <a href="${escapeHtml(href)}">${escapeHtml(entry.original_path)}</a>
    <span class="badge status-${status}">${status}</span>
    ${stale ? '<span class="badge status-stale">upstream changed</span>' : ""}
    <span class="progress">${progress.translated}/${progress.total} blocks</span>
    ${flagged.length ? `<span class="badge status-needs-attention">${flagged.length} flagged</span>` : ""}
    ${flaggedList}
  </li>`;
}
