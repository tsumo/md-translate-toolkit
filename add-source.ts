/**
 * Claims an upstream file: fetches it at a pinned commit, writes its
 * manifest entry, and generates a translation skeleton (every block
 * present, each marked untranslated with a text preview — ADR-007,
 * ADR-020). See TODO.md Phase 1.
 *
 * Usage: tsx tools/add-source.ts <path> [--commit <sha>]
 *   <path> is relative to the upstream repo root, e.g.
 *   "reviewed/Ars Magica - Definitive Edition (Core Rules).md"
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { fetchOriginal } from "./cache.js";
import { writeManifestEntry } from "./manifest-io.js";
import { parseBlocks, fingerprintBlock, placeholderFor, stringifyBlocks } from "./split-blocks.js";
import type { BlockEntry, ManifestEntry } from "./types.js";

const SOURCE_REPO = "OriginalMadman/Ars-Magica-Open-License";
const DEFAULT_BRANCH = "main";

async function resolveCommit(commitArg: string | undefined): Promise<string> {
  if (commitArg) return commitArg;
  const url = `https://api.github.com/repos/${SOURCE_REPO}/commits/${DEFAULT_BRANCH}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to resolve HEAD commit (${DEFAULT_BRANCH}): ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { sha: string };
  return data.sha;
}

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { commit: { type: "string" } },
  });

  const [path] = positionals;
  if (!path) {
    console.error("Usage: tsx tools/add-source.ts <path> [--commit <sha>]");
    process.exit(1);
  }

  const commit = await resolveCommit(values.commit);
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

  const manifestPath = `manifest/${path}.json`;
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
