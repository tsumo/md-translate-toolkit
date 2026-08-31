/**
 * This is a local server. For each claimed document, it loads the cached
 * original and the translation file. It splits both files into blocks.
 * It zips the blocks by position. It renders an original and translation
 * two-column HTML page.
 *
 * Usage: tsx tools/dev.ts [--port <number>]
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { glob } from "glob";
import type { Root, RootContent } from "mdast";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { fetchOriginal } from "./cache.js";
import { readManifestEntry } from "./manifest-io.js";
import { parseBlocks } from "./split-blocks.js";
import type { ManifestEntry } from "./types.js";

const { values } = parseArgs({ args: process.argv.slice(2), options: { port: { type: "string" } } });
const PORT = Number(values.port ?? 4000);

const toHtml = unified().use(remarkRehype).use(rehypeStringify);

function blockToHtml(node: RootContent): string {
  const root: Root = { type: "root", children: [node] };
  return toHtml.stringify(toHtml.runSync(root));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PAGE_STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem 2rem; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1.5rem; }
  .columns > * { min-width: 0; overflow-wrap: break-word; padding: 0.4rem 0; border-bottom: 1px solid #eee; }
  .columns > :nth-child(4n+1), .columns > :nth-child(4n+2) { background: #fafafa; }
  h1, h2 { color: #222; }
`;

async function renderDocumentPage(entry: ManifestEntry): Promise<string> {
  const original = await fetchOriginal(entry.source_repo, entry.source_commit, entry.original_path);
  const translation = readFileSync(entry.translation_path, "utf-8");

  const originalBlocks = parseBlocks(original);
  const translationBlocks = parseBlocks(translation);
  const rowCount = Math.max(originalBlocks.length, translationBlocks.length);

  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const left = originalBlocks[i] ? blockToHtml(originalBlocks[i]) : "";
    const right = translationBlocks[i] ? blockToHtml(translationBlocks[i]) : "";
    rows.push(`<div>${left}</div><div>${right}</div>`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(entry.original_path)}</title><style>${PAGE_STYLE}</style></head>
<body>
<p><a href="/">&larr; all documents</a></p>
<div class="columns">${rows.join("")}</div>
</body></html>`;
}

async function renderIndexPage(): Promise<string> {
  const manifestPaths = await glob("manifest/**/*.json");
  const items = manifestPaths
    .sort()
    .map((manifestPath) => {
      const entry = readManifestEntry(manifestPath);
      const href = `/doc/${encodeURIComponent(entry.original_path)}`;
      return `<li><a href="${href}">${escapeHtml(entry.original_path)}</a></li>`;
    })
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Translations</title><style>${PAGE_STYLE}</style></head>
<body><h1>Claimed documents</h1><ul>${items}</ul></body></html>`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
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

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
});
