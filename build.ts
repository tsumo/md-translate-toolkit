/**
 * Builds the static site into `/site/`: one page per claimed document, plus
 * an index page. Same rendering core as the local dev server. This is the
 * read-only public artifact published to GitHub Pages.
 * Runs the same checks as verify.ts first. Any failure aborts before anything
 * under /site/ is touched (ADR-014, ADR-015).
 *
 * Usage: tsx tools/build.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { RootContent } from "mdast";
import { NotFoundError } from "./cache.js";
import { diffAgainstUpstream, hasChanges } from "./diff-upstream.js";
import { globManifestPaths, PROJECT_ROOT, sitePathFor } from "./paths.js";
import { documentToBlockHtml, renderDocumentPage, renderIndexPage } from "./render.js";
import type { ManifestEntry } from "./types.js";
import { verifyAll } from "./verify-checks.js";

const SITE_ROOT = join(PROJECT_ROOT, "site");

function outputPathFor(entry: ManifestEntry): string {
  // The raw path, not URL-encoded: a browser decodes an encoded href back to
  // these exact characters when it requests the page, so the file on disk
  // must be named with the real characters too.
  return join(SITE_ROOT, sitePathFor(entry.original_path));
}

function buildDocumentPage(entry: ManifestEntry, originalNodes: RootContent[], translationNodes: RootContent[]): void {
  const outPath = outputPathFor(entry);
  // A document page can sit several directories deep (mirroring `original_path`), and the
  // site is served from an unknown base path (e.g. a GitHub Pages project subpath). So the
  // link back to the index is relative to this page's own file, not an absolute `/`.
  const backHref = relative(dirname(outPath), join(SITE_ROOT, "index.html"));
  const originalHtml = documentToBlockHtml(originalNodes);
  const page = renderDocumentPage(entry, originalHtml, translationNodes, backHref);

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
  const { entries, results, hasErrors } = await verifyAll(manifestPaths, true);
  if (hasErrors) process.exit(1);

  rmSync(SITE_ROOT, { recursive: true, force: true });
  mkdirSync(SITE_ROOT, { recursive: true });

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { originalNodes, translationNodes } = results[i];
    // hasErrors is false, so translationNodes are present
    if (!translationNodes) throw new Error(`unreachable: ${entry.original_path} has no translationNodes`);

    buildDocumentPage(entry, originalNodes, translationNodes);
    console.log(`built  ${entry.original_path}`);
  }
  await buildIndexPage(entries);
  console.log(`built  index (${entries.length} document${entries.length === 1 ? "" : "s"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
