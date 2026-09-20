/**
 * Builds the static site. It fetches every pinned original, checks the shape of each manifest, then checks
 * hashes, block alignment, and completion claims (ADR-009, ADR-017). Any failure stops the build before the
 * site folder changes. It uses the same rendering code as the dev server.
 *
 * Usage: md-translate build [--config <path>]
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import type { RootContent } from "mdast";
import { NotFoundError } from "../cache.js";
import type { ResolvedConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { diffAgainstUpstream, hasChanges } from "../diff-upstream.js";
import { validateManifestShape } from "../manifest-schema.js";
import { globManifestPaths, sitePathFor } from "../paths.js";
import { documentToBlockHtml } from "../render/blocks.js";
import { renderDocumentPage } from "../render/document.js";
import { renderIndexPage } from "../render/index-page.js";
import type { ManifestEntry } from "../types.js";
import { verifyAll } from "../verify-checks.js";

function siteRoot(config: ResolvedConfig): string {
  return join(config.root, config.siteDir);
}

const STYLESHEET_SOURCE = join(import.meta.dirname, "../assets/page.css");

function stylesheetPath(config: ResolvedConfig): string {
  return join(siteRoot(config), "assets/page.css");
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
  // A page can sit in nested folders, and the site can be served from any base path.
  // So the link to the index is relative to this page.
  const backHref = relative(dirname(outPath), join(siteRoot(config), "index.html"));
  const stylesheetHref = relative(dirname(outPath), stylesheetPath(config));
  const originalHtml = documentToBlockHtml(originalNodes);
  const page = renderDocumentPage(
    entry,
    originalHtml,
    translationNodes,
    backHref,
    { licenseName: config.licenseName, licenseUrl: config.licenseUrl },
    { stylesheetHref },
  );

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
      const reason = err instanceof NotFoundError ? "not found at upstream HEAD" : `staleness check failed (${err})`;
      console.error(`${entry.original_path}: ${reason} — skipping staleness check.`);
    }
  }
  return staleness;
}

async function buildIndexPage(config: ResolvedConfig, entries: ManifestEntry[]): Promise<void> {
  const staleness = await computeStaleness(entries, config.cacheDir, config.defaultBranch);
  const attribution = { licenseName: config.licenseName, licenseUrl: config.licenseUrl };
  writeFileSync(
    join(siteRoot(config), "index.html"),
    renderIndexPage(entries, attribution, { stylesheetHref: "assets/page.css" }, staleness),
  );
}

/** Checks the shape of each manifest and prints `ok` or `FAIL`. Returns true when any check fails. */
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

export async function runBuild(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { config: { type: "string" } } });
  const config = await loadConfig(values.config);

  const manifestPaths = await globManifestPaths(config.root, config.manifestDir);

  // Check the shape first. A malformed manifest would crash the content checks with a confusing error.
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
  mkdirSync(dirname(stylesheetPath(config)), { recursive: true });
  copyFileSync(STYLESHEET_SOURCE, stylesheetPath(config));

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
