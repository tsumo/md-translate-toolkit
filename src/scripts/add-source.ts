/**
 * Claims an upstream file. It fetches the file at a pinned commit, writes the manifest entry, and creates a
 * translation skeleton with a placeholder for each block (ADR-006).
 *
 * Usage: md-translate add-source [<path>] [--commit <sha>] [--config <path>]
 *   <path> is relative to the upstream repository root, such as "reviewed/Some File.md". In a terminal, a
 *   picker of unclaimed files opens without it.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { fetchOriginal, resolveCommit } from "../cache.js";
import { loadConfig } from "../config.js";
import { writeManifestEntry } from "../manifest-io.js";
import { manifestPathFor } from "../paths.js";
import { canPrompt, pickUpstreamPath } from "../pick-path.js";
import { fingerprintBlock, parseBlocks, placeholderFor, stringifyBlocks } from "../split-blocks.js";
import type { BlockEntry, ManifestEntry } from "../types.js";

export async function runAddSource(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { commit: { type: "string" }, config: { type: "string" } },
  });

  const config = await loadConfig(values.config);
  if (!config.defaultRepo) {
    console.error("No upstream repo configured. Set `upstream.defaultRepo` in translate.config.js.");
    process.exit(1);
  }
  const sourceRepo = config.defaultRepo;

  const commit = await resolveCommit(sourceRepo, values.commit, config.defaultBranch);

  const path =
    positionals[0] ??
    (canPrompt() ? await pickUpstreamPath(sourceRepo, commit, config.root, config.manifestDir) : undefined);
  if (!path) {
    console.error("Usage: md-translate add-source <path> [--commit <sha>] [--config <path>]");
    process.exit(1);
  }

  const content = await fetchOriginal(sourceRepo, commit, path, config.cacheDir);
  const sha256 = createHash("sha256").update(content).digest("hex");

  const nodes = parseBlocks(content);
  const blocks: BlockEntry[] = nodes.map((node) => ({
    kind: node.type,
    fingerprint: fingerprintBlock(node),
    status: "in-progress",
  }));

  const translationPath = `${config.translationsDir}/${path}`;
  const manifestEntry: ManifestEntry = {
    original_path: path,
    source_repo: sourceRepo,
    source_commit: commit,
    source_sha256: sha256,
    translation_path: translationPath,
    last_synced: new Date().toISOString().slice(0, 10),
    blocks,
  };

  const manifestPath = manifestPathFor(path, config.manifestDir);
  writeManifestEntry(manifestPath, manifestEntry);

  const skeletonNodes = nodes.map((node) => placeholderFor(node));
  const skeleton = stringifyBlocks(skeletonNodes);
  mkdirSync(dirname(translationPath), { recursive: true });
  writeFileSync(translationPath, skeleton);

  console.log(`✓ ${manifestPath}`);
  console.log(`✓ ${translationPath}`);
  console.log(`${blocks.length} blocks, all placeholders — ready to translate.`);
}
