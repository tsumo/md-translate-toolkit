import type { RootContent } from "mdast";
import type { DiffEntry } from "./diff-upstream.js";
import { fingerprintBlock, placeholderFor } from "./split-blocks.js";
import type { BlockEntry, BlockStatus } from "./types.js";

/** The status of a block after an update. Only a changed block that was complete or verified loses its status (ADR-008). */
export function resolveStatus(
  diffEntry: DiffEntry | undefined,
  oldBlocks: BlockEntry[],
  today: string,
): { status: BlockStatus; status_comment?: string } {
  if (diffEntry?.kind === "unchanged") {
    const old = oldBlocks[diffEntry.oldIndex];
    return { status: old.status, status_comment: old.status_comment };
  }
  if (diffEntry?.kind === "changed") {
    const old = oldBlocks[diffEntry.oldIndex];
    if (old.status === "complete" || old.status === "verified") {
      return {
        status: "needs-attention",
        status_comment: `Upstream content changed on ${today} — re-check against source.`,
      };
    }
    return { status: old.status, status_comment: old.status_comment };
  }
  // Added block: no old block to copy from, so use the default status.
  return { status: "in-progress" };
}

/**
 * Unchanged and changed blocks keep their old translation, even at a new index. An added block gets a new
 * placeholder. A removed block gets no output (ADR-008).
 */
export function applyResync(
  diff: DiffEntry[],
  oldBlocks: BlockEntry[],
  oldTranslationNodes: RootContent[],
  newNodes: RootContent[],
  today: string,
): { translationNodes: RootContent[]; blocks: BlockEntry[] } {
  const diffByNewIndex = new Map<number, DiffEntry>();
  for (const e of diff) diffByNewIndex.set(e.newIndex, e);

  const translationNodes = newNodes.map((node, newIndex) => {
    const diffEntry = diffByNewIndex.get(newIndex);
    if (diffEntry?.kind === "unchanged" || diffEntry?.kind === "changed") {
      return oldTranslationNodes[diffEntry.oldIndex];
    }
    return placeholderFor(node);
  });

  const blocks: BlockEntry[] = newNodes.map((node, newIndex) => {
    const resolved = resolveStatus(diffByNewIndex.get(newIndex), oldBlocks, today);
    return {
      kind: node.type,
      fingerprint: fingerprintBlock(node),
      status: resolved.status,
      ...(resolved.status_comment !== undefined ? { status_comment: resolved.status_comment } : {}),
    };
  });

  return { translationNodes, blocks };
}
