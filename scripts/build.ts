/**
 * The one command that takes a fresh clone to a working static site:
 * fetches every pinned original into the local cache, validates every
 * manifest file's shape, then checks each one's checksum, block
 * alignment, and translation completeness (ADR-012, ADR-013). Any
 * failure aborts before anything under `/site/` is touched. Same
 * rendering core as the local dev server.
 *
 * Usage: tsx tools/scripts/build.ts [--config <path>]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import type { RootContent } from "mdast";
import { NotFoundError } from "../cache.js";
import type { ResolvedConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { diffAgainstUpstream, hasChanges } from "../diff-upstream.js";
import { validateManifestShape } from "../manifest-schema.js";
import { globManifestPaths, sitePathFor } from "../paths.js";
import { documentToBlockHtml, renderDocumentPage, renderIndexPage } from "../render.js";
import type { ManifestEntry } from "../types.js";
import { verifyAll } from "../verify-checks.js";

function siteRoot(config: ResolvedConfig): string {
  return join(config.root, config.siteDir);
}

function outputPathFor(config: ResolvedConfig, entry: ManifestEntry): string {
  return join(siteRoot(config), sitePathFor(entry.original_path));
}

function buildDocumentPage(
  config: ResolvedConfig,
  entry: ManifestEntry,
  originalNodes: RootContent[],
  translationNodes: RootContent[],
): void {
  const outPath = outputPathFor(config, entry);
  // A document page can sit several directories deep (mirroring `original_path`), and the
  // site is served from an unknown base path (e.g. a GitHub Pages project subpath). So the
  // link back to the index is relative to this page's own file, not an absolute `/`.
  const backHref = relative(dirname(outPath), join(siteRoot(config), "index.html"));
  const originalHtml = documentToBlockHtml(originalNodes);
  const page = renderDocumentPage(entry, originalHtml, translationNodes, backHref, {
    licenseName: config.licenseName,
    licenseUrl: config.licenseUrl,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, page);
}

async function computeStaleness(
  entries: ManifestEntry[],
  cacheDir: string,
  defaultBranch: string,
): Promise<Map<string, boolean>> {
  const staleness = new Map<string, boolean>();
  for (const entry of entries) {
    try {
      const { commit, diff } = await diffAgainstUpstream(entry, undefined, cacheDir, defaultBranch);
      staleness.set(entry.original_path, commit !== entry.source_commit && hasChanges(diff, entry.blocks.length));
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      console.error(`${entry.original_path}: not found at upstream HEAD — skipping staleness check.`);
    }
  }
  return staleness;
}

async function buildIndexPage(config: ResolvedConfig, entries: ManifestEntry[]): Promise<void> {
  const staleness = await computeStaleness(entries, config.cacheDir, config.defaultBranch);
  const attribution = { licenseName: config.licenseName, licenseUrl: config.licenseUrl };
  writeFileSync(join(siteRoot(config), "index.html"), renderIndexPage(entries, attribution, "", staleness));
}

/** Validates every manifest file's shape, printing an `ok`/`FAIL` line for each. Returns whether any failed. */
function checkManifestShapes(config: ResolvedConfig, manifestPaths: string[]): boolean {
  let hasErrors = false;
  for (const { path, errors } of validateManifestShape(manifestPaths)) {
    const displayPath = relative(config.root, path);
    if (errors.length === 0) {
      console.log(`ok    ${displayPath}`);
    } else {
      hasErrors = true;
      console.error(`FAIL  ${displayPath}`);
      for (const err of errors) console.error(`      ${err}`);
    }
  }
  return hasErrors;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { config: { type: "string" } } });
  const config = await loadConfig(values.config);

  const manifestPaths = await globManifestPaths(config.root, config.manifestDir);

  // Shape first: a malformed manifest file would otherwise crash the content
  // checks below with a confusing error instead of Ajv's clear one.
  if (checkManifestShapes(config, manifestPaths)) process.exit(1);

  const { entries, results, hasErrors } = await verifyAll(
    manifestPaths,
    true,
    config.root,
    config.translationsDir,
    config.cacheDir,
  );
  if (hasErrors) process.exit(1);

  const root = siteRoot(config);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { originalNodes, translationNodes } = results[i];
    // hasErrors is false, so translationNodes are present
    if (!translationNodes) throw new Error(`unreachable: ${entry.original_path} has no translationNodes`);

    buildDocumentPage(config, entry, originalNodes, translationNodes);
    console.log(`built  ${entry.original_path}`);
  }
  await buildIndexPage(config, entries);
  console.log(`built  index (${entries.length} document${entries.length === 1 ? "" : "s"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
