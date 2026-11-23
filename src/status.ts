/** Status rules for blocks and documents (ADR-010). The toolkit never stores document status. */
import type { BlockEntry, BlockStatus, TranslationStatus } from "./types.js";

export const VALID_BLOCK_STATUSES: BlockStatus[] = [
  "untranslated",
  "in-progress",
  "complete",
  "verified",
  "needs-attention",
];

export function isValidBlockStatus(value: string): value is BlockStatus {
  return (VALID_BLOCK_STATUSES as string[]).includes(value);
}

/**
 * True for a verified block of a kind the toolkit verifies at creation: a divider, or a raw HTML block with
 * no translatable content (ADR-017). The manifest cannot tell a toolkit-owned status from a person's, so a
 * person-verified html block reads the same; the next sync normalizes structural html, which bounds the
 * ambiguity. Such a status is not a person's claim, so it cannot start a document.
 */
function isVerifiedStructuralKind(block: BlockEntry): boolean {
  return block.status === "verified" && (block.kind === "thematicBreak" || block.kind === "html");
}

/** The status of a document, derived from its blocks' statuses alone (ADR-010). */
export function deriveFileStatus(blocks: BlockEntry[]): TranslationStatus {
  if (blocks.some((b) => b.status === "needs-attention")) return "needs-attention";
  if (blocks.every((b) => b.status === "verified")) return "verified";
  if (blocks.every((b) => b.status === "complete" || b.status === "verified")) return "complete";
  const started = blocks.some((b) => b.status !== "untranslated" && !isVerifiedStructuralKind(b));
  return started ? "in-progress" : "not-started";
}

/**
 * Checks a status change and applies it to `entry` in memory. The caller writes the manifest only when this
 * returns `ok: true`. `set-status` and the dev server share this function (ADR-014), so it writes no files
 * and prints nothing. A comment rides on any status and is stored trimmed, so a blank one means no comment.
 * needs-attention refuses without one.
 */
export function applyBlockStatus(
  entry: { blocks: BlockEntry[] },
  targetIndices: number[],
  status: BlockStatus,
  comment: string | undefined,
): { ok: true; fileStatus: TranslationStatus } | { ok: false; error: string } {
  for (const index of targetIndices) {
    if (!entry.blocks[index]) {
      return { ok: false, error: `No block at index ${index} (file has ${entry.blocks.length} blocks, 0-indexed).` };
    }
  }

  const storedComment = comment?.trim() || undefined;
  if (status === "needs-attention" && !storedComment) {
    return { ok: false, error: '"needs-attention" should have a comment explaining what needs attention.' };
  }

  for (const index of targetIndices) {
    entry.blocks[index].status = status;
    entry.blocks[index].status_comment = storedComment;
  }

  return { ok: true, fileStatus: deriveFileStatus(entry.blocks) };
}
