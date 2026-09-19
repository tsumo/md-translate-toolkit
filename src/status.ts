/** Status rules for blocks and documents (ADR-010, ADR-017). The toolkit never stores document status. */
import type { RootContent } from "mdast";
import { truncatedList } from "./diff-upstream.js";
import { isUntranslated, parseBlocks, translationProgress } from "./split-blocks.js";
import type { BlockEntry, BlockStatus, ManifestEntry, TranslationStatus } from "./types.js";

export const VALID_BLOCK_STATUSES: BlockStatus[] = ["in-progress", "complete", "verified", "needs-attention"];

export function isValidBlockStatus(value: string): value is BlockStatus {
  return (VALID_BLOCK_STATUSES as string[]).includes(value);
}

export function isInvalidCompletion(status: BlockStatus, node: RootContent): boolean {
  return (status === "complete" || status === "verified") && isUntranslated(node);
}

export function deriveFileStatus(
  blocks: BlockEntry[],
  progress: { translated: number; total: number },
): TranslationStatus {
  if (blocks.some((b) => b.status === "needs-attention")) return "needs-attention";
  if (blocks.every((b) => b.status === "verified")) return "verified";
  if (blocks.every((b) => b.status === "complete" || b.status === "verified")) return "complete";
  if (progress.translated === 0) return "not-started";
  return "in-progress";
}

/**
 * Checks a status change and applies it to `entry` in memory. The caller writes the manifest only when this
 * returns `ok: true`. `set-status` and the dev server share this function (ADR-014), so it writes no files
 * and prints nothing.
 */
export function applyBlockStatus(
  entry: ManifestEntry,
  translationMarkdown: string,
  targetIndices: number[],
  status: BlockStatus,
  comment: string | undefined,
): { ok: true; fileStatus: TranslationStatus } | { ok: false; error: string } {
  for (const index of targetIndices) {
    if (!entry.blocks[index]) {
      return { ok: false, error: `No block at index ${index} (file has ${entry.blocks.length} blocks, 0-indexed).` };
    }
  }

  if (status === "needs-attention" && !comment) {
    return { ok: false, error: '"needs-attention" should have a comment explaining what needs attention.' };
  }

  const translationNodes = parseBlocks(translationMarkdown);
  const stillPlaceholder = targetIndices.filter((index) => isInvalidCompletion(status, translationNodes[index]));
  if (stillPlaceholder.length > 0) {
    return {
      ok: false,
      error: `Cannot set "${status}": block(s) ${truncatedList(stillPlaceholder)} still hold a placeholder.`,
    };
  }

  for (const index of targetIndices) {
    entry.blocks[index].status = status;
    entry.blocks[index].status_comment = comment;
  }

  return { ok: true, fileStatus: deriveFileStatus(entry.blocks, translationProgress(translationMarkdown)) };
}
