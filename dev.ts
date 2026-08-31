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
import { fetchOriginal } from "./cache.js";
import { readManifestEntry } from "./manifest-io.js";
import { documentToBlockHtml, pageWrapper, renderDocumentBody, renderIndexItem } from "./render.js";
import { parseBlocks } from "./split-blocks.js";
import type { ManifestEntry } from "./types.js";

const { values } = parseArgs({ args: process.argv.slice(2), options: { port: { type: "string" } } });
const PORT = Number(values.port ?? 4000);

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

const LIVE_RELOAD_SCRIPT = `<script>
  const events = new EventSource("/events");
  events.onmessage = () => location.reload();
</script>`;

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

async function renderDocumentPage(entry: ManifestEntry): Promise<string> {
  const translation = readFileSync(entry.translation_path, "utf-8");
  const translationNodes = parseBlocks(translation);

  const originalHtml = await renderOriginalHtml(entry);
  const translationHtml = documentToBlockHtml(translationNodes);

  const body = renderDocumentBody("/", originalHtml, translationHtml, translationNodes);
  return pageWrapper(entry.original_path, body, LIVE_RELOAD_SCRIPT);
}

async function renderIndexPage(): Promise<string> {
  const manifestPaths = await glob("manifest/**/*.json");
  const items = manifestPaths
    .sort()
    .map((manifestPath) => renderIndexItem(readManifestEntry(manifestPath)))
    .join("");
  return pageWrapper("Translations", `<h1>Claimed documents</h1><ul class="index">${items}</ul>`, LIVE_RELOAD_SCRIPT);
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
    if (url.pathname.startsWith("/doc/") && url.pathname.endsWith(".html")) {
      const originalPath = decodeURIComponent(url.pathname)
        .replace(/^\/doc\//, "")
        .replace(/\.html$/, "");
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
