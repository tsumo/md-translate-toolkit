/**
 * Claims an upstream file: fetches it at a pinned commit, writes its
 * manifest entry, and generates a translation skeleton (every block
 * present, each marked untranslated with a text preview — ADR-007).
 *
 * Usage: md-translate add-source [<path>] [--commit <sha>] [--config <path>]
 *   <path> is relative to the upstream repo root, e.g.
 *   "reviewed/Ars Magica - Definitive Edition (Core Rules).md". In a
 *   terminal, omitting <path> opens a picker over unclaimed upstream files
 *   instead.
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
