/** Derives a document's file-level status from its blocks. Never stored (ADR-015). */
import type { BlockEntry, BlockStatus, TranslationStatus } from "./types.js";

export const VALID_BLOCK_STATUSES: BlockStatus[] = ["in-progress", "complete", "verified", "needs-attention"];

export function isValidBlockStatus(value: string): value is BlockStatus {
  return (VALID_BLOCK_STATUSES as string[]).includes(value);
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
