import type { RootContent } from "mdast";
import type { DiffEntry } from "./diff-upstream.js";
import { hasTranslatableContent } from "./placeholder.js";
import { fingerprintBlock, placeholderFor } from "./split-blocks.js";
import type { BlockEntry, BlockStatus } from "./types.js";

/**
 * The status of a block after an update. A changed block loses its status when it was complete or verified,
 * or when it has no translatable content (ADR-008, ADR-018). The toolkit owns the status of a block with no
 * translatable content (ADR-018): it is verified whatever it was, unless a needs-attention flag waits on a person.
 */
export function resolveStatus(
  diffEntry: DiffEntry | undefined,
  oldBlocks: BlockEntry[],
  today: string,
  newNode: RootContent,
): { status: BlockStatus; status_comment?: string } {
  const structural = !hasTranslatableContent(newNode);
  if (diffEntry?.kind === "unchanged") {
    const old = oldBlocks[diffEntry.oldIndex];
    if (structural && old.status !== "needs-attention") {
      return { status: "verified", status_comment: old.status_comment };
    }
    return { status: old.status, status_comment: old.status_comment };
  }
  if (diffEntry?.kind === "changed") {
    const old = oldBlocks[diffEntry.oldIndex];
    if (structural || old.status === "complete" || old.status === "verified") {
      return {
        status: "needs-attention",
        status_comment: `Upstream content changed on ${today} — re-check against source.`,
      };
    }
    return { status: old.status, status_comment: old.status_comment };
  }
  // Added block: no old block to copy from, so use the default status.
  return { status: structural ? "verified" : "in-progress" };
}

/**
 * Unchanged and changed blocks keep their old translation, even at a new index, but a changed block with no
 * translatable content takes the new upstream text, because its translation is a passthrough of upstream and
 * holds nothing of the person's own (ADR-018). An added block gets a new placeholder. A removed block gets no
 * output (ADR-008).
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
    if (diffEntry?.kind === "unchanged") {
      return oldTranslationNodes[diffEntry.oldIndex];
    }
    if (diffEntry?.kind === "changed") {
      if (!hasTranslatableContent(node)) return node;
      return oldTranslationNodes[diffEntry.oldIndex];
    }
    return placeholderFor(node);
  });

  const blocks: BlockEntry[] = newNodes.map((node, newIndex) => {
    const resolved = resolveStatus(diffByNewIndex.get(newIndex), oldBlocks, today, node);
    return {
      kind: node.type,
      fingerprint: fingerprintBlock(node),
      status: resolved.status,
      ...(resolved.status_comment !== undefined ? { status_comment: resolved.status_comment } : {}),
    };
  });

  return { translationNodes, blocks };
}
