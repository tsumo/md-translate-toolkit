/**
 * Compares the blocks of a manifest entry with the blocks of a newer upstream commit, by fingerprint
 * (ADR-011, ADR-013). A fingerprint in both lists, in order, is unchanged, even at a new index. Between two
 * matches, leftover old and new blocks pair by position as changed. Extra new blocks are added. A leftover
 * old block gets no entry, so the caller finds it with `removedOldIndices`.
 */
import { diffArrays } from "diff";
import type { RootContent } from "mdast";
import { fetchOriginal, resolveCommit } from "./cache.js";
import { type ContentBlock, fingerprintBlock, parseBlocks } from "./split-blocks.js";
import type { ManifestEntry } from "./types.js";

export type DiffEntry =
  | { kind: "unchanged"; oldIndex: number; newIndex: number }
  | { kind: "changed"; oldIndex: number; newIndex: number }
  | { kind: "added"; newIndex: number };

/** Diffs two block lists by fingerprint. The header comment gives the rules. */
export function diffBlocks(oldBlocks: ContentBlock[], newBlocks: ContentBlock[]): DiffEntry[] {
  const changes = diffArrays(
    oldBlocks.map((b) => b.fingerprint),
    newBlocks.map((b) => b.fingerprint),
  );

  const entries: DiffEntry[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  for (let i = 0; i < changes.length; ) {
    const change = changes[i];
    if (!change.added && !change.removed) {
      for (let k = 0; k < change.value.length; k++) {
        entries.push({ kind: "unchanged", oldIndex: oldIndex + k, newIndex: newIndex + k });
      }
      oldIndex += change.value.length;
      newIndex += change.value.length;
      i++;
      continue;
    }

    // Removed and added chunks between two matches. Pair them by position, oldest first.
    let removedCount = 0;
    let addedCount = 0;
    while (i < changes.length && (changes[i].added || changes[i].removed)) {
      if (changes[i].removed) removedCount += changes[i].value.length;
      if (changes[i].added) addedCount += changes[i].value.length;
      i++;
    }

    const pairCount = Math.min(removedCount, addedCount);
    for (let k = 0; k < pairCount; k++) {
      entries.push({ kind: "changed", oldIndex: oldIndex + k, newIndex: newIndex + k });
    }
    for (let k = pairCount; k < addedCount; k++) {
      entries.push({ kind: "added", newIndex: newIndex + k });
    }

    oldIndex += removedCount;
    newIndex += addedCount;
  }

  return entries;
}

/** Old indices that no entry uses. Upstream removed these blocks. */
export function removedOldIndices(entries: DiffEntry[], oldBlockCount: number): number[] {
  const referenced = new Set(entries.flatMap((e) => ("oldIndex" in e ? [e.oldIndex] : [])));
  const removed: number[] = [];
  for (let i = 0; i < oldBlockCount; i++) {
    if (!referenced.has(i)) removed.push(i);
  }
  return removed;
}

/** Fetches the file at `commitArg` (the branch head by default) and diffs it with the blocks of `entry`. */
export async function diffAgainstUpstream(
  entry: ManifestEntry,
  commitArg: string | undefined,
  cacheDir: string,
  defaultBranch: string,
): Promise<{ commit: string; content: string; newNodes: RootContent[]; diff: DiffEntry[] }> {
  const commit = await resolveCommit(entry.source_repo, commitArg, defaultBranch);
  if (commit === entry.source_commit) {
    return { commit, content: "", newNodes: [], diff: [] };
  }

  const content = await fetchOriginal(entry.source_repo, commit, entry.original_path, cacheDir);
  const newNodes = parseBlocks(content);
  const newBlocks: ContentBlock[] = newNodes.map((node) => ({
    kind: node.type,
    fingerprint: fingerprintBlock(node),
  }));
  const diff = diffBlocks(entry.blocks, newBlocks);
  return { commit, content, newNodes, diff };
}

/** True when `diff` has a real content change. A new commit with the same content is not a change. */
export function hasChanges(diff: DiffEntry[], oldBlockCount: number): boolean {
  return diff.some((e) => e.kind !== "unchanged") || removedOldIndices(diff, oldBlockCount).length > 0;
}

const MAX_LISTED = 10;

export function truncatedList(indices: number[]): string {
  return indices.length <= MAX_LISTED
    ? indices.join(", ")
    : `${indices.slice(0, MAX_LISTED).join(", ")}, … (${indices.length} total)`;
}

/** A short report of `diff`: a header line, then one line each for changed, added, and removed blocks. */
export function formatDiffReport(entry: ManifestEntry, commit: string, diff: DiffEntry[]): string {
  const header = `${entry.original_path}: ${entry.source_commit.slice(0, 7)} → ${commit.slice(0, 7)}`;
  if (commit === entry.source_commit) return `${header} (up to date)`;
  if (!hasChanges(diff, entry.blocks.length)) return `${header} (no block-level changes)`;

  const changed = diff.filter((e) => e.kind === "changed").map((e) => e.newIndex);
  const added = diff.filter((e) => e.kind === "added").map((e) => e.newIndex);
  const removed = removedOldIndices(diff, entry.blocks.length);

  const lines = [header];
  if (changed.length) lines.push(`  ${changed.length} block(s) changed: ${truncatedList(changed)}`);
  if (added.length) lines.push(`  ${added.length} block(s) added: ${truncatedList(added)}`);
  if (removed.length) lines.push(`  ${removed.length} block(s) removed: ${truncatedList(removed)}`);
  return lines.join("\n");
}
