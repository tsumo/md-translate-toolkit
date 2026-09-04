/**
 * Shared HTML rendering core for the local dev server and the static site
 * build: converts blocks to HTML, and renders the page shell, the
 * two-column document body, and the per-document index entry.
 */
import { readFileSync } from "node:fs";
import type { Root as HastRoot } from "hast";
import type { Root, RootContent } from "mdast";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { encodePathSegments, hrefForDoc } from "./paths.js";
import { isUntranslated, parseBlocks, translationProgress } from "./split-blocks.js";
import { deriveFileStatus } from "./status.js";
import type { ManifestEntry } from "./types.js";

const toHast = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeSlug);
const stringifyHast = unified().use(rehypeStringify, { allowDangerousHtml: true });

/**
 * This converts a whole document to HTML, one block at a time. Heading
 * IDs need document-wide state for correct dedup. So this function
 * converts the whole tree once. Then it splits the result back into
 * per-block HTML, for the two-column zip.
 */
export function documentToBlockHtml(nodes: RootContent[]): string[] {
  const mdastRoot: Root = { type: "root", children: nodes };
  const hastRoot = toHast.runSync(mdastRoot) as HastRoot;
  // remark-rehype inserts a whitespace-only text node between each block,
  // as a formatting separator. Drop these, or block indices no longer
  // line up with the original block list.
  const blocks = hastRoot.children.filter((child) => child.type !== "text" || child.value.trim() !== "");
  return blocks.map((child) => stringifyHast.stringify({ type: "root", children: [child] }));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PAGE_STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem 2rem; }
  .columns { display: grid; grid-template-columns: max-content 1fr 1fr; gap: 0 1.5rem; }
  @media (max-width: 768px) {
    .columns { grid-template-columns: 1fr; }
  }
  .columns > * { min-width: 0; overflow-wrap: break-word; padding: 0.4rem; }
  .columns > :nth-child(6n+2), .columns > :nth-child(6n+3) { background: #fafafa; }
  .columns > .untranslated { background: #fff7e6; }
  .block-index { color: #999; font-size: 0.8rem; text-align: right; margin: 1rem 0; }
  h1, h2 { color: #222; }
  ul.index > li { margin-bottom: 0.6rem; }
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 1rem; font-size: 0.8rem; color: #fff; }
  .status-not-started { background: #999; }
  .status-in-progress { background: #3b82f6; }
  .status-complete { background: #0d9488; }
  .status-verified { background: #16a34a; }
  .status-needs-attention { background: #dc2626; }
  .status-stale { background: #d97706; }
  .progress { color: #666; font-size: 0.85rem; }
  ul.flagged { margin: 0.2rem 0 0 1rem; color: #dc2626; font-size: 0.85rem; }
  footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; color: #888; font-size: 0.8rem; }
`;

/** The full page shell around `bodyHtml`. `extraBodyHtml` is appended after it, e.g. a live-reload script. */
export function pageWrapper(title: string, bodyHtml: string, extraBodyHtml = ""): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head>
<body>${bodyHtml}${extraBodyHtml}</body></html>`;
}

const ORIGINAL_REPO_URL = "https://github.com/OriginalMadman/Ars-Magica-Open-License";
const CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

/** A link to `path` as it exists in `repo` at `commit`, viewable on GitHub's web UI. */
function githubBlobUrl(repo: string, commit: string, path: string): string {
  return `https://github.com/${repo}/blob/${commit}/${encodePathSegments(path)}`;
}

/**
 * Attribution chrome for the generated site, satisfying CC BY-SA 4.0 since
 * a translated file itself carries none (DECISIONS.md, ADR-016). `entry`
 * adds a link to that document's exact pinned commit; omit it for a page
 * with no single document behind it, like the index.
 */
function renderFooter(entry?: ManifestEntry): string {
  const commitLink = entry
    ? ` (<a href="${githubBlobUrl(entry.source_repo, entry.source_commit, entry.original_path)}">view original at this commit</a>)`
    : "";
  return `<footer><p>Translated from <a href="${ORIGINAL_REPO_URL}">Ars Magica Open License</a>${commitLink} —
    a modified (translated) derivative work, licensed under <a href="${CC_BY_SA_URL}">CC BY-SA 4.0</a>.</p></footer>`;
}

/**
 * The three-column index|original|translation body for one document's
 * page. The index column shows each block's position — the same number
 * `set-status.ts`'s `--block` flag takes (ADR-006). `backHref` is the link
 * back to the index — an absolute `/` for the dev server (always served
 * from the true root), or a path relative to this page's own output file
 * for the static build (served under an unknown base path).
 */
export function renderDocumentBody(
  backHref: string,
  originalHtml: string[],
  translationHtml: string[],
  translationNodes: RootContent[],
): string {
  const rowCount = Math.max(originalHtml.length, translationHtml.length);
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const node = translationNodes[i];
    const rightClass = node && isUntranslated(node) ? ' class="untranslated"' : "";
    rows.push(
      `<div><p class="block-index">${i}</p></div>`,
      `<div>${originalHtml[i] ?? ""}</div>`,
      `<div${rightClass}>${translationHtml[i] ?? ""}</div>`,
    );
  }
  return `<p><a href="${escapeHtml(backHref)}">&larr; all documents</a></p><div class="columns">${rows.join("")}</div>`;
}

export async function renderDocumentPage(
  entry: ManifestEntry,
  getOriginalHtml: (entry: ManifestEntry) => Promise<string[]>,
  backHref: string,
  extraBodyHtml = "",
): Promise<string> {
  const translationNodes = parseBlocks(readFileSync(entry.translation_path, "utf-8"));
  const originalHtml = await getOriginalHtml(entry);
  const translationHtml = documentToBlockHtml(translationNodes);

  const body = renderDocumentBody(backHref, originalHtml, translationHtml, translationNodes) + renderFooter(entry);
  return pageWrapper(entry.original_path, body, extraBodyHtml);
}

export function renderIndexPage(
  entries: ManifestEntry[],
  extraBodyHtml = "",
  staleness?: Map<string, boolean>,
): string {
  const items = entries
    .map((entry) => {
      const progress = translationProgress(readFileSync(entry.translation_path, "utf-8"));
      const stale = staleness?.get(entry.original_path) ?? false;
      return renderIndexItem(entry, progress, stale);
    })
    .join("");
  const body = `<h1>Claimed documents</h1><ul class="index">${items}</ul>${renderFooter()}`;
  return pageWrapper("Translations", body, extraBodyHtml);
}

/** One `<li>` entry for the index page: link, status badge, progress, and any flagged blocks. */
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
