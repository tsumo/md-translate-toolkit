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

/**
 * A document's page path, relative to the site root, e.g. `doc/reviewed/Foo.md.html`.
 * A real `.html` file, not a directory with an `index.html` inside it — this way
 * the link works whether it is opened over `file://`, any static server, or GitHub
 * Pages, with no dependency on a server's directory-index behavior.
 */
export function hrefForDoc(originalPath: string): string {
  return `doc/${encodeURI(originalPath)}.html`;
}

const PAGE_STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem 2rem; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1.5rem; }
  .columns > * { min-width: 0; overflow-wrap: break-word; padding: 0.4rem 0; border-bottom: 1px solid #eee; }
  .columns > :nth-child(4n+1), .columns > :nth-child(4n+2) { background: #fafafa; }
  .columns > .untranslated { background: #fff7e6; }
  h1, h2 { color: #222; }
  ul.index > li { margin-bottom: 0.6rem; }
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 1rem; font-size: 0.8rem; color: #fff; }
  .status-not-started { background: #999; }
  .status-in-progress { background: #3b82f6; }
  .status-complete { background: #0d9488; }
  .status-verified { background: #16a34a; }
  .status-needs-attention { background: #dc2626; }
  .progress { color: #666; font-size: 0.85rem; }
  ul.flagged { margin: 0.2rem 0 0 1rem; color: #dc2626; font-size: 0.85rem; }
`;

/** The full page shell around `bodyHtml`. `extraBodyHtml` is appended after it, e.g. a live-reload script. */
export function pageWrapper(title: string, bodyHtml: string, extraBodyHtml = ""): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head>
<body>${bodyHtml}${extraBodyHtml}</body></html>`;
}

/**
 * The two-column original|translation body for one document's page.
 * `backHref` is the link back to the index — an absolute `/` for the dev
 * server (always served from the true root), or a path relative to this
 * page's own output file for the static build (served under an unknown
 * base path).
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
    rows.push(`<div>${originalHtml[i] ?? ""}</div><div${rightClass}>${translationHtml[i] ?? ""}</div>`);
  }
  return `<p><a href="${backHref}">&larr; all documents</a></p><div class="columns">${rows.join("")}</div>`;
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

  const body = renderDocumentBody(backHref, originalHtml, translationHtml, translationNodes);
  return pageWrapper(entry.original_path, body, extraBodyHtml);
}

export function renderIndexPage(entries: ManifestEntry[], extraBodyHtml = ""): string {
  const items = entries.map((entry) => renderIndexItem(entry)).join("");
  return pageWrapper("Translations", `<h1>Claimed documents</h1><ul class="index">${items}</ul>`, extraBodyHtml);
}

/** One `<li>` entry for the index page: link, status badge, progress, and any flagged blocks. */
export function renderIndexItem(entry: ManifestEntry): string {
  const progress = translationProgress(readFileSync(entry.translation_path, "utf-8"));
  const status = deriveFileStatus(entry.blocks, progress);
  const href = hrefForDoc(entry.original_path);

  const flagged = entry.blocks.filter((block) => block.status === "needs-attention");
  const flaggedList = flagged.length
    ? `<ul class="flagged">${flagged
        .map((block) => `<li>block ${block.index}: ${escapeHtml(block.status_comment ?? "")}</li>`)
        .join("")}</ul>`
    : "";

  return `<li>
    <a href="${href}">${escapeHtml(entry.original_path)}</a>
    <span class="badge status-${status}">${status}</span>
    <span class="progress">${progress.translated}/${progress.total} blocks</span>
    ${flagged.length ? `<span class="badge status-needs-attention">${flagged.length} flagged</span>` : ""}
    ${flaggedList}
  </li>`;
}
