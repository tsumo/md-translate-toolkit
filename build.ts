/**
 * Builds the static site into `/site/`: one page per claimed document, plus
 * an index page. Same rendering core as the local dev server
 * (`tools/dev.ts`), via `tools/render.ts`. This is the read-only public
 * artifact published to GitHub Pages.
 *
 * Usage: tsx tools/build.ts
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { glob } from "glob";
import { fetchOriginal } from "./cache.js";
import { readManifestEntry } from "./manifest-io.js";
import { documentToBlockHtml, pageWrapper, renderDocumentBody, renderIndexItem } from "./render.js";
import { parseBlocks } from "./split-blocks.js";
import type { ManifestEntry } from "./types.js";

const SITE_ROOT = "site";

function outputPathFor(entry: ManifestEntry): string {
  // Use the raw path, not `hrefForDoc`'s URL-encoded form: a browser decodes
  // an encoded href back to these exact characters when it requests the
  // page, so the file on disk must be named with the real characters too.
  return join(SITE_ROOT, "doc", `${entry.original_path}.html`);
}

async function buildDocumentPage(entry: ManifestEntry): Promise<void> {
  const original = await fetchOriginal(entry.source_repo, entry.source_commit, entry.original_path);
  const translation = readFileSync(entry.translation_path, "utf-8");
  const translationNodes = parseBlocks(translation);

  const originalHtml = documentToBlockHtml(parseBlocks(original));
  const translationHtml = documentToBlockHtml(translationNodes);

  const outPath = outputPathFor(entry);
  // A document page can sit several directories deep (mirroring `original_path`), and the
  // site is served from an unknown base path (e.g. a GitHub Pages project subpath). So the
  // link back to the index is relative to this page's own file, not an absolute `/`.
  const backHref = relative(dirname(outPath), join(SITE_ROOT, "index.html"));
  const body = renderDocumentBody(backHref, originalHtml, translationHtml, translationNodes);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, pageWrapper(entry.original_path, body));
}

function buildIndexPage(entries: ManifestEntry[]): void {
  const items = entries.map((entry) => renderIndexItem(entry)).join("");
  const page = pageWrapper("Translations", `<h1>Claimed documents</h1><ul class="index">${items}</ul>`);
  writeFileSync(join(SITE_ROOT, "index.html"), page);
}

async function main(): Promise<void> {
  rmSync(SITE_ROOT, { recursive: true, force: true });
  mkdirSync(SITE_ROOT, { recursive: true });

  const manifestPaths = (await glob("manifest/**/*.json")).sort();
  const entries = manifestPaths.map((manifestPath) => readManifestEntry(manifestPath));

  for (const entry of entries) {
    await buildDocumentPage(entry);
    console.log(`built  ${entry.original_path}`);
  }
  buildIndexPage(entries);
  console.log(`built  index (${entries.length} document${entries.length === 1 ? "" : "s"})`);
}

main();
