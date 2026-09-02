/**
 * Applies an upstream diff: rewrites the translation file to stay
 * positionally aligned with the new block list, and updates the manifest
 * to match (DECISIONS.md ADR-012, ADR-015).
 *
 * Usage: tsx tools/resync.ts <path> [--commit <sha>]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type DiffEntry, diffAgainstUpstream, formatDiffReport } from "./diff-upstream.js";
import { readManifestEntry, writeManifestEntry } from "./manifest-io.js";
import { manifestPathFor } from "./paths.js";
import { fingerprintBlock, parseBlocks, placeholderFor, stringifyBlocks } from "./split-blocks.js";
import type { BlockEntry, BlockStatus, ManifestEntry } from "./types.js";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { commit: { type: "string" } },
});

const [path] = positionals;
if (!path) {
  console.error("Usage: tsx tools/resync.ts <path> [--commit <sha>]");
  process.exit(1);
}

/** The status a new block should carry, per ADR-015: precise, not a whole-file downgrade. */
function resolveStatus(
  diffEntry: DiffEntry | undefined,
  entry: ManifestEntry,
  today: string,
): { status: BlockStatus; status_comment?: string } {
  if (diffEntry?.kind === "unchanged") {
    const old = entry.blocks[diffEntry.oldIndex];
    return { status: old.status, status_comment: old.status_comment };
  }
  if (diffEntry?.kind === "changed") {
    const old = entry.blocks[diffEntry.oldIndex];
    if (old.status === "complete" || old.status === "verified") {
      return {
        status: "needs-attention",
        status_comment: `Upstream content changed on ${today} — re-check against source.`,
      };
    }
    return { status: old.status, status_comment: old.status_comment };
  }
  // added: no prior block to inherit from — the same tooling default claiming a new document uses.
  return { status: "in-progress" };
}

async function main(): Promise<void> {
  const manifestPath = manifestPathFor(path);
  const entry = readManifestEntry(manifestPath);
  const { commit, content, newNodes, diff } = await diffAgainstUpstream(entry, values.commit);

  if (commit === entry.source_commit) {
    console.log(formatDiffReport(entry, commit, diff));
    return;
  }

  const diffByNewIndex = new Map<number, DiffEntry>();
  for (const e of diff) diffByNewIndex.set(e.newIndex, e);

  const translationNodes = parseBlocks(readFileSync(entry.translation_path, "utf-8"));
  const today = new Date().toISOString().slice(0, 10);

  const newTranslationNodes = newNodes.map((node, newIndex) => {
    const diffEntry = diffByNewIndex.get(newIndex);
    if (diffEntry?.kind === "unchanged" || diffEntry?.kind === "changed") {
      return translationNodes[diffEntry.oldIndex];
    }
    return placeholderFor(node);
  });

  const newBlocks: BlockEntry[] = newNodes.map((node, newIndex) => {
    const resolved = resolveStatus(diffByNewIndex.get(newIndex), entry, today);
    return {
      index: newIndex,
      kind: node.type,
      fingerprint: fingerprintBlock(node),
      status: resolved.status,
      ...(resolved.status_comment !== undefined ? { status_comment: resolved.status_comment } : {}),
    };
  });

  writeFileSync(entry.translation_path, stringifyBlocks(newTranslationNodes));
  writeManifestEntry(manifestPath, {
    ...entry,
    source_commit: commit,
    source_sha256: createHash("sha256").update(content).digest("hex"),
    last_synced: today,
    blocks: newBlocks,
  });

  console.log(formatDiffReport(entry, commit, diff));
  console.log(`Applied: ${manifestPath} and ${entry.translation_path} updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
