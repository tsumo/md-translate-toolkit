import type { RootContent } from "mdast";
import type { DiffEntry } from "./diff-upstream.js";
import { fingerprintBlock, placeholderFor } from "./split-blocks.js";
import type { BlockEntry, BlockStatus } from "./types.js";

/** The status a new block should carry, per ADR-015: precise, not a whole-file downgrade. */
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
  // added: no prior block to inherit from — the same tooling default claiming a new document uses.
  return { status: "in-progress" };
}

/**
 * Unchanged and changed blocks carry the old translation node forward
 * (even at a shifted index); an added block gets a fresh placeholder
 * generated from the new upstream node; a removed old block has no
 * corresponding output at all — deletion is intentional here (ADR-012).
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
