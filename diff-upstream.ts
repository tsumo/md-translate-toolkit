/**
 * Compares a manifest entry's current blocks against a newer upstream
 * commit's blocks, by fingerprint (ADR-017). A block whose fingerprint
 * appears in both lists, in order, is unchanged, even at a shifted index.
 * Between two such matches, any leftover old and new blocks pair up
 * positionally as changed; leftover new blocks past that pairing are
 * added. A leftover old block gets no entry — the caller finds it as an
 * index no entry points at (`removedOldIndices`).
 *
 * Shared by `check-updates` (read-only report) and `resync.ts` (applies
 * the diff). No CLI entry of its own: `check-updates <path>` covers the
 * single-file case.
 */
import { diffArrays } from "diff";
import { fetchOriginal, resolveCommit } from "./cache.js";
import { type ContentBlock, splitBlocks } from "./split-blocks.js";
import type { ManifestEntry } from "./types.js";

export type DiffEntry =
  | { kind: "unchanged"; oldIndex: number; newIndex: number }
  | { kind: "changed"; oldIndex: number; newIndex: number }
  | { kind: "added"; newIndex: number };

/** Diffs two block lists by fingerprint. See the module comment for the classification rules. */
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

    // A run of one or more removed/added chunks between two matched runs.
    // Pair them up positionally, oldest-first on each side.
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

/** Old indices no `DiffEntry` refers to: the blocks upstream removed outright. */
export function removedOldIndices(entries: DiffEntry[], oldBlockCount: number): number[] {
  const referenced = new Set(entries.flatMap((e) => ("oldIndex" in e ? [e.oldIndex] : [])));
  const removed: number[] = [];
  for (let i = 0; i < oldBlockCount; i++) {
    if (!referenced.has(i)) removed.push(i);
  }
  return removed;
}

/** Fetches `entry`'s file at `commitArg` (HEAD by default) and diffs it against `entry`'s current blocks. */
export async function diffAgainstUpstream(
  entry: ManifestEntry,
  commitArg: string | undefined,
): Promise<{ commit: string; newBlocks: ContentBlock[]; diff: DiffEntry[] }> {
  const commit = await resolveCommit(entry.source_repo, commitArg);
  const content = await fetchOriginal(entry.source_repo, commit, entry.original_path);
  const newBlocks = splitBlocks(content);
  const diff = diffBlocks(entry.blocks, newBlocks);
  return { commit, newBlocks, diff };
}
