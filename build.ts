/**
 * Builds the static site into `/site/`: one page per claimed document, plus
 * an index page. Same rendering core as the local dev server. This is the
 * read-only public artifact published to GitHub Pages.
 *
 * Usage: tsx tools/build.ts — builds directly, with no checksum gate.
 * `npm run build` chains that gate first.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fetchOriginal } from "./cache.js";
import { readManifestEntry } from "./manifest-io.js";
import { globManifestPaths, PROJECT_ROOT } from "./paths.js";
import { documentToBlockHtml, renderDocumentPage, renderIndexPage } from "./render.js";
import { parseBlocks } from "./split-blocks.js";
import type { ManifestEntry } from "./types.js";

const SITE_ROOT = join(PROJECT_ROOT, "site");

function outputPathFor(entry: ManifestEntry): string {
  // Use the raw path, not `hrefForDoc`'s URL-encoded form: a browser decodes
  // an encoded href back to these exact characters when it requests the
  // page, so the file on disk must be named with the real characters too.
  return join(SITE_ROOT, "doc", `${entry.original_path}.html`);
}

async function getOriginalHtml(entry: ManifestEntry): Promise<string[]> {
  const original = await fetchOriginal(entry.source_repo, entry.source_commit, entry.original_path);
  return documentToBlockHtml(parseBlocks(original));
}

async function buildDocumentPage(entry: ManifestEntry): Promise<void> {
  const outPath = outputPathFor(entry);
  // A document page can sit several directories deep (mirroring `original_path`), and the
  // site is served from an unknown base path (e.g. a GitHub Pages project subpath). So the
  // link back to the index is relative to this page's own file, not an absolute `/`.
  const backHref = relative(dirname(outPath), join(SITE_ROOT, "index.html"));
  const page = await renderDocumentPage(entry, getOriginalHtml, backHref);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, page);
}

function buildIndexPage(entries: ManifestEntry[]): void {
  writeFileSync(join(SITE_ROOT, "index.html"), renderIndexPage(entries));
}

async function main(): Promise<void> {
  const manifestPaths = await globManifestPaths();
  const entries = manifestPaths.map((manifestPath) => readManifestEntry(manifestPath));

  rmSync(SITE_ROOT, { recursive: true, force: true });
  mkdirSync(SITE_ROOT, { recursive: true });

  for (const entry of entries) {
    await buildDocumentPage(entry);
    console.log(`built  ${entry.original_path}`);
  }
  buildIndexPage(entries);
  console.log(`built  index (${entries.length} document${entries.length === 1 ? "" : "s"})`);
}

main();
