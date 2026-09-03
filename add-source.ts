/**
 * Claims an upstream file: fetches it at a pinned commit, writes its
 * manifest entry, and generates a translation skeleton (every block
 * present, each marked untranslated with a text preview — ADR-007).
 *
 * Usage: tsx tools/add-source.ts [<path>] [--commit <sha>]
 *   <path> is relative to the upstream repo root, e.g.
 *   "reviewed/Ars Magica - Definitive Edition (Core Rules).md". In a
 *   terminal, omitting <path> opens a picker over unclaimed upstream files
 *   instead.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { fetchOriginal, resolveCommit } from "./cache.js";
import { writeManifestEntry } from "./manifest-io.js";
import { manifestPathFor } from "./paths.js";
import { canPrompt, pickUpstreamPath } from "./pick-path.js";
import { fingerprintBlock, parseBlocks, placeholderFor, stringifyBlocks } from "./split-blocks.js";
import type { BlockEntry, ManifestEntry } from "./types.js";

const SOURCE_REPO = "OriginalMadman/Ars-Magica-Open-License";

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { commit: { type: "string" } },
  });

  const commit = await resolveCommit(SOURCE_REPO, values.commit);

  const path = positionals[0] ?? (canPrompt() ? await pickUpstreamPath(SOURCE_REPO, commit) : undefined);
  if (!path) {
    console.error("Usage: tsx tools/add-source.ts <path> [--commit <sha>]");
    process.exit(1);
  }

  const content = await fetchOriginal(SOURCE_REPO, commit, path);
  const sha256 = createHash("sha256").update(content).digest("hex");

  const nodes = parseBlocks(content);
  const blocks: BlockEntry[] = nodes.map((node, index) => ({
    index,
    kind: node.type,
    fingerprint: fingerprintBlock(node),
    status: "in-progress",
  }));

  const translationPath = `translations/${path}`;
  const manifestEntry: ManifestEntry = {
    original_path: path,
    source_repo: SOURCE_REPO,
    source_commit: commit,
    source_sha256: sha256,
    translation_path: translationPath,
    last_synced: new Date().toISOString().slice(0, 10),
    blocks,
  };

  const manifestPath = manifestPathFor(path);
  writeManifestEntry(manifestPath, manifestEntry);

  const skeletonNodes = nodes.map((node) => placeholderFor(node));
  const skeleton = stringifyBlocks(skeletonNodes);
  mkdirSync(dirname(translationPath), { recursive: true });
  writeFileSync(translationPath, skeleton);

  console.log(`✓ ${manifestPath}`);
  console.log(`✓ ${translationPath}`);
  console.log(`${blocks.length} blocks, all placeholders — ready to translate.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
