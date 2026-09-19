/**
 * Local dev server. It shows the original and the translation of each claimed document side by side, reloads
 * the page when a file changes, and accepts block status changes.
 *
 * Usage: md-translate dev [--port <number>] [--config <path>]
 */
import { existsSync, readFileSync, watch } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { fetchOriginal } from "../cache.js";
import { loadConfig } from "../config.js";
import { readManifestEntry, writeManifestEntry } from "../manifest-io.js";
import { globManifestPaths, manifestPathFor } from "../paths.js";
import { documentToBlockHtml, renderDocumentPage, renderIndexPage } from "../render.js";
import { parseBlocks } from "../split-blocks.js";
import { applyBlockStatus, isValidBlockStatus } from "../status.js";
import type { ManifestEntry } from "../types.js";

// Open live-reload connections. A file change writes to every one of these.
const liveReloadClients = new Set<ServerResponse>();

function broadcastReload(): void {
  for (const client of liveReloadClients) client.write("data: reload\n\n");
}

/** Watches a folder. It calls `onChange` at most once per 200 ms. */
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

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function runDev(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: "string" }, config: { type: "string" } },
  });
  const PORT = Number(values.port ?? 4000);
  const config = await loadConfig(values.config);
  const attribution = { licenseName: config.licenseName, licenseUrl: config.licenseUrl };

  // Block HTML of each pinned original, keyed by commit and path. A commit never changes,
  // so only a change in the originals cache clears an entry.
  const originalHtmlCache = new Map<string, string[]>();

  async function renderOriginalHtml(entry: ManifestEntry): Promise<string[]> {
    const key = `${entry.source_commit}:${entry.original_path}`;
    const cached = originalHtmlCache.get(key);
    if (cached) return cached;

    const original = await fetchOriginal(entry.source_repo, entry.source_commit, entry.original_path, config.cacheDir);
    const html = documentToBlockHtml(parseBlocks(original));
    originalHtmlCache.set(key, html);
    return html;
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
        const manifestPaths = await globManifestPaths(config.root, config.manifestDir);
        const entries = manifestPaths.map((manifestPath) => readManifestEntry(manifestPath));
        const page = renderIndexPage(entries, attribution, LIVE_RELOAD_SCRIPT);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }
      if (url.pathname.startsWith("/doc/") && url.pathname.endsWith(".html")) {
        const originalPath = decodeURIComponent(url.pathname)
          .replace(/^\/doc\//, "")
          .replace(/\.html$/, "");
        const manifestPath = manifestPathFor(originalPath, config.manifestDir);
        const entry = readManifestEntry(manifestPath);
        const translationNodes = parseBlocks(readFileSync(entry.translation_path, "utf-8"));
        const originalHtml = await renderOriginalHtml(entry);
        const page = renderDocumentPage(
          entry,
          originalHtml,
          translationNodes,
          "/",
          attribution,
          LIVE_RELOAD_SCRIPT,
          true,
        );
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/status") {
        const form = new URLSearchParams(await readRequestBody(req));
        const path = form.get("path");
        const block = Number(form.get("block"));
        const status = form.get("status") ?? "";
        const comment = form.get("comment") || undefined;

        if (!path || !Number.isInteger(block) || !isValidBlockStatus(status)) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("Invalid status update request.");
          return;
        }

        const manifestPath = manifestPathFor(path, config.manifestDir);
        const entry = readManifestEntry(manifestPath);
        const translationMarkdown = readFileSync(entry.translation_path, "utf-8");
        const result = applyBlockStatus(entry, translationMarkdown, [block], status, comment);
        if (!result.ok) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end(result.error);
          return;
        }

        writeManifestEntry(manifestPath, entry);
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(err));
    }
  });

  watchDirectory(config.translationsDir, broadcastReload);
  watchDirectory(config.manifestDir, broadcastReload);
  watchDirectory(config.cacheDir, () => {
    originalHtmlCache.clear();
    broadcastReload();
  });

  server.listen(PORT, () => {
    console.log(`Dev server running at http://localhost:${PORT}`);
  });
}
