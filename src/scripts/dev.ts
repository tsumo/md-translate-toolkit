/**
 * Local dev server. It shows the original and the translation of each claimed document side by side, reloads
 * the page when a file changes, accepts block status changes, and serves the inline block editor: it hands
 * a block's raw Markdown source to the browser and writes an edited block back into the translation file
 * and the manifest.
 *
 * Usage: md-translate dev [--port <number>] [--config <path>]
 */
import { existsSync, readFileSync, watch, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildSync } from "esbuild";
import type { RootContent } from "mdast";
import { rawBlockSource, replaceBlockSource } from "../block-source.js";
import { fetchOriginal } from "../cache.js";
import { loadConfig } from "../config.js";
import { readManifestEntry, writeManifestEntry } from "../manifest-io.js";
import { parseBlocks } from "../parse-blocks.js";
import { globManifestPaths, isSafeOriginalPath, manifestPathFor } from "../paths.js";
import { documentToBlockHtml } from "../render/blocks.js";
import { renderDocumentPage } from "../render/document.js";
import { renderIndexPage } from "../render/index-page.js";
import { applyBlockStatus, isValidBlockStatus } from "../status.js";
import type { ManifestEntry } from "../types.js";
import { validateBlockText } from "../validate-block-text.js";

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

const STYLESHEET_PATH = join(import.meta.dirname, "../assets/page.css");
const STYLESHEET_HREF = "/assets/page.css";

const CLIENT_ENTRY = join(import.meta.dirname, "../client/main.ts");

/** The client bundle as one classic-script string, built from `src/client/main.ts`. */
function bundleClient(): string {
  const result = buildSync({
    entryPoints: [CLIENT_ENTRY],
    bundle: true,
    format: "iife",
    target: "es2022",
    // The client's JSX runs on hono/jsx/dom, whose elements are real DOM nodes — not the server's
    // string-rendering hono/jsx.
    jsx: "automatic",
    jsxImportSource: "hono/jsx/dom",
    write: false,
  });
  return result.outputFiles[0].text;
}

const CLIENT_SCRIPT_HREF = "/assets/client.js";
const CLIENT_SCRIPT_TAG = `<script src="${CLIENT_SCRIPT_HREF}" defer></script>`;

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

/**
 * The path and block fields that all three API endpoints share, checked once: a non-empty safe original path
 * and a non-negative integer block index. Returns null when either fails, and the caller answers 400.
 */
function parseBlockRequest(
  path: string | null,
  block: string | null,
  manifestDir: string,
): { path: string; block: number } | null {
  // `Number("")` is 0, so a blank field must become NaN here, or it would silently mean block 0.
  const trimmed = (block ?? "").trim();
  const index = trimmed === "" ? Number.NaN : Number(trimmed);
  if (!path || !Number.isInteger(index) || index < 0 || !isSafeOriginalPath(path, manifestDir)) return null;
  return { path, block: index };
}

export async function runDev(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: "string" }, config: { type: "string" } },
  });
  const PORT = Number(values.port ?? 4000);
  const config = await loadConfig(values.config);
  const clientBundle = bundleClient();
  const attribution = { licenseName: config.licenseName, licenseUrl: config.licenseUrl };

  // Block HTML and nodes of each pinned original, keyed by commit and path. A commit never changes,
  // so only a change in the originals cache clears an entry.
  const originalRenderCache = new Map<string, { html: string[]; nodes: RootContent[] }>();

  async function renderOriginal(entry: ManifestEntry): Promise<{ html: string[]; nodes: RootContent[] }> {
    const key = `${entry.source_commit}:${entry.original_path}`;
    const cached = originalRenderCache.get(key);
    if (cached) return cached;

    const original = await fetchOriginal(entry.source_repo, entry.source_commit, entry.original_path, config.cacheDir);
    const nodes = parseBlocks(original);
    const rendered = { html: documentToBlockHtml(nodes), nodes };
    originalRenderCache.set(key, rendered);
    return rendered;
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
      if (url.pathname === STYLESHEET_HREF) {
        res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" });
        res.end(readFileSync(STYLESHEET_PATH));
        return;
      }
      if (url.pathname === CLIENT_SCRIPT_HREF) {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
        res.end(clientBundle);
        return;
      }
      if (url.pathname === "/") {
        const manifestPaths = await globManifestPaths(config.root, config.manifestDir);
        const entries = manifestPaths.map((manifestPath) => readManifestEntry(manifestPath));
        const page = renderIndexPage(entries, attribution, {
          stylesheetHref: STYLESHEET_HREF,
          extraBodyHtml: CLIENT_SCRIPT_TAG,
        });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }
      if (url.pathname.startsWith("/doc/") && url.pathname.endsWith(".html")) {
        const originalPath = decodeURIComponent(url.pathname)
          .replace(/^\/doc\//, "")
          .replace(/\.html$/, "");
        if (!isSafeOriginalPath(originalPath, config.manifestDir)) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("Not found");
          return;
        }
        const manifestPath = manifestPathFor(originalPath, config.manifestDir);
        const entry = readManifestEntry(manifestPath);
        const translationNodes = parseBlocks(readFileSync(entry.translation_path, "utf-8"));
        const original = await renderOriginal(entry);
        const page = renderDocumentPage(
          entry,
          original.html,
          translationNodes,
          "/",
          attribution,
          { stylesheetHref: STYLESHEET_HREF, extraBodyHtml: CLIENT_SCRIPT_TAG },
          true,
          original.nodes,
        );
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/block") {
        const parsed = parseBlockRequest(
          url.searchParams.get("path"),
          url.searchParams.get("block"),
          config.manifestDir,
        );
        if (!parsed) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("Invalid block request.");
          return;
        }
        const entry = readManifestEntry(manifestPathFor(parsed.path, config.manifestDir));
        if (!entry.blocks[parsed.block]) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end(`No block at index ${parsed.block} (file has ${entry.blocks.length} blocks, 0-indexed).`);
          return;
        }
        const markdown = readFileSync(entry.translation_path, "utf-8");
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({ text: rawBlockSource(markdown, parsed.block), kind: entry.blocks[parsed.block].kind }),
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/block") {
        const form = new URLSearchParams(await readRequestBody(req));
        const parsed = parseBlockRequest(form.get("path"), form.get("block"), config.manifestDir);
        const status = form.get("status") ?? "";
        if (!parsed || !isValidBlockStatus(status)) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("Invalid block save request.");
          return;
        }
        // A blank comment means no comment. The shared status logic owns that rule.
        const comment = form.get("comment") ?? undefined;
        const text = form.get("text") ?? "";
        const manifestPath = manifestPathFor(parsed.path, config.manifestDir);
        const entry = readManifestEntry(manifestPath);
        const blockEntry = entry.blocks[parsed.block];
        if (!blockEntry) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end(`No block at index ${parsed.block} (file has ${entry.blocks.length} blocks, 0-indexed).`);
          return;
        }
        // The same submission rule the browser checked before sending, now against the manifest kind.
        const check = validateBlockText(text, blockEntry.kind);
        if (!check.ok) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end(check.error);
          return;
        }
        const translationPath = entry.translation_path;
        const updatedMarkdown = replaceBlockSource(readFileSync(translationPath, "utf-8"), parsed.block, text);
        // The status applies to the edited text, so the placeholder refusal reads the file as it would become.
        const result = applyBlockStatus(entry, updatedMarkdown, [parsed.block], status, comment);
        if (!result.ok) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end(result.error);
          return;
        }
        writeFileSync(translationPath, updatedMarkdown);
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
    originalRenderCache.clear();
    broadcastReload();
  });

  server.listen(PORT, () => {
    console.log(`Dev server running at http://localhost:${PORT}`);
  });
}
