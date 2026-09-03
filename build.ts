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
import { fetchOriginal, NotFoundError } from "./cache.js";
import { diffAgainstUpstream, hasChanges } from "./diff-upstream.js";
import { readManifestEntry } from "./manifest-io.js";
import { globManifestPaths, PROJECT_ROOT, sitePathFor } from "./paths.js";
import { documentToBlockHtml, renderDocumentPage, renderIndexPage } from "./render.js";
import { parseBlocks } from "./split-blocks.js";
import type { ManifestEntry } from "./types.js";

const SITE_ROOT = join(PROJECT_ROOT, "site");

function outputPathFor(entry: ManifestEntry): string {
  // The raw path, not URL-encoded: a browser decodes an encoded href back to
  // these exact characters when it requests the page, so the file on disk
  // must be named with the real characters too.
  return join(SITE_ROOT, sitePathFor(entry.original_path));
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

async function computeStaleness(entries: ManifestEntry[]): Promise<Map<string, boolean>> {
  const staleness = new Map<string, boolean>();
  for (const entry of entries) {
    try {
      const { commit, diff } = await diffAgainstUpstream(entry, undefined);
      staleness.set(entry.original_path, commit !== entry.source_commit && hasChanges(diff, entry.blocks.length));
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      console.error(`${entry.original_path}: not found at upstream HEAD — skipping staleness check.`);
    }
  }
  return staleness;
}

async function buildIndexPage(entries: ManifestEntry[]): Promise<void> {
  const staleness = await computeStaleness(entries);
  writeFileSync(join(SITE_ROOT, "index.html"), renderIndexPage(entries, "", staleness));
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
  await buildIndexPage(entries);
  console.log(`built  index (${entries.length} document${entries.length === 1 ? "" : "s"})`);
}

main();
