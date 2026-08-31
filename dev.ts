/**
 * This is a local server. For each claimed document, it loads the cached
 * original and the translation file. It splits both files into blocks.
 * It zips the blocks by position. It renders an original and translation
 * two-column HTML page.
 *
 * Usage: tsx tools/dev.ts [--port <number>]
 */
import { existsSync, readFileSync, watch } from "node:fs";
import type { ServerResponse } from "node:http";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { glob } from "glob";
import type { Root as HastRoot } from "hast";
import type { Root, RootContent } from "mdast";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { fetchOriginal } from "./cache.js";
import { readManifestEntry } from "./manifest-io.js";
import { isUntranslated, parseBlocks, translationProgress } from "./split-blocks.js";
import { deriveFileStatus } from "./status.js";
import type { ManifestEntry } from "./types.js";

const { values } = parseArgs({ args: process.argv.slice(2), options: { port: { type: "string" } } });
const PORT = Number(values.port ?? 4000);

const toHast = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeSlug);
const stringifyHast = unified().use(rehypeStringify, { allowDangerousHtml: true });

/**
 * This converts a whole document to HTML, one block at a time. Heading
 * IDs need document-wide state for correct dedup. So this function
 * converts the whole tree once. Then it splits the result back into
 * per-block HTML, for the two-column zip.
 */
function documentToBlockHtml(nodes: RootContent[]): string[] {
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

// Rendered HTML per block for a pinned original, keyed by commit + path.
// An original is immutable for its pinned commit (ADR-018), so a cache
// entry never goes stale on its own — only a `.cache/originals` change
// (a re-fetch after a manifest edit) can invalidate it.
const originalHtmlCache = new Map<string, string[]>();

async function renderOriginalHtml(entry: ManifestEntry): Promise<string[]> {
  const key = `${entry.source_commit}:${entry.original_path}`;
  const cached = originalHtmlCache.get(key);
  if (cached) return cached;

  const original = await fetchOriginal(entry.source_repo, entry.source_commit, entry.original_path);
  const html = documentToBlockHtml(parseBlocks(original));
  originalHtmlCache.set(key, html);
  return html;
}

// Open live-reload connections. A file change writes to every one of these.
const liveReloadClients = new Set<ServerResponse>();

function broadcastReload(): void {
  for (const client of liveReloadClients) client.write("data: reload\n\n");
}

/** This watches a directory. On any change, it calls `onChange` at most once per 200ms. */
function watchDirectory(dir: string, onChange: () => void): void {
  if (!existsSync(dir)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(dir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 200);
  });
}

const LIVE_RELOAD_SCRIPT = `
  const events = new EventSource("/events");
  events.onmessage = () => location.reload();
`;

function pageWrapper(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head>
<body>${bodyHtml}<script>${LIVE_RELOAD_SCRIPT}</script></body></html>`;
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

async function renderDocumentPage(entry: ManifestEntry): Promise<string> {
  const translation = readFileSync(entry.translation_path, "utf-8");

  const translationNodes = parseBlocks(translation);
  const originalHtml = await renderOriginalHtml(entry);
  const translationHtml = documentToBlockHtml(translationNodes);
  const rowCount = Math.max(originalHtml.length, translationHtml.length);

  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const node = translationNodes[i];
    const rightClass = node && isUntranslated(node) ? ' class="untranslated"' : "";
    rows.push(`<div>${originalHtml[i] ?? ""}</div><div${rightClass}>${translationHtml[i] ?? ""}</div>`);
  }

  const body = `<p><a href="/">&larr; all documents</a></p><div class="columns">${rows.join("")}</div>`;
  return pageWrapper(entry.original_path, body);
}

function renderIndexItem(entry: ManifestEntry): string {
  const progress = translationProgress(readFileSync(entry.translation_path, "utf-8"));
  const status = deriveFileStatus(entry.blocks, progress);
  const href = `/doc/${encodeURIComponent(entry.original_path)}`;

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

async function renderIndexPage(): Promise<string> {
  const manifestPaths = await glob("manifest/**/*.json");
  const items = manifestPaths
    .sort()
    .map((manifestPath) => renderIndexItem(readManifestEntry(manifestPath)))
    .join("");
  return pageWrapper("Translations", `<h1>Claimed documents</h1><ul class="index">${items}</ul>`);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      liveReloadClients.add(res);
      req.on("close", () => liveReloadClients.delete(res));
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await renderIndexPage());
      return;
    }
    if (url.pathname.startsWith("/doc/")) {
      const originalPath = decodeURIComponent(url.pathname.slice("/doc/".length));
      const manifestPath = `manifest/${originalPath}.json`;
      const entry = readManifestEntry(manifestPath);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await renderDocumentPage(entry));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(err));
  }
});

watchDirectory("translations", broadcastReload);
watchDirectory(".cache/originals", () => {
  originalHtmlCache.clear();
  broadcastReload();
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
});
