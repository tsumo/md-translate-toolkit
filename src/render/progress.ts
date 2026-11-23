/** Progress counts and bar segments shared by the index cards and the document header. */
import type { BlockEntry, BlockStatus, ManifestEntry } from "../types.js";

export type Progress = { translated: number; total: number };

/** The block statuses a progress bar draws, left to right. */
export const BAR_STATUSES: BlockStatus[] = ["untranslated", "verified", "complete", "needs-attention", "in-progress"];

export function countingBlocks(entry: Pick<ManifestEntry, "blocks">): BlockEntry[] {
  return entry.blocks.filter((block) => block.kind !== "thematicBreak");
}

export function needsAttentionCount(counting: BlockEntry[]): number {
  return counting.filter((block) => block.status === "needs-attention").length;
}

/** The progress of a manifest entry: blocks claimed complete or verified, of all countable blocks. */
export function progressOf(entry: Pick<ManifestEntry, "blocks">): Progress {
  const counting = countingBlocks(entry);
  return {
    translated: counting.filter((block) => block.status === "complete" || block.status === "verified").length,
    total: counting.length,
  };
}

/** The segments of a progress bar: one per status, in draw order. A document with nothing
 * claimed yet draws one not-started segment. */
export function barSegments(
  counting: BlockEntry[],
  progress: Progress,
): { status: BlockStatus | "not-started"; count: number }[] {
  if (progress.translated === 0) return counting.length > 0 ? [{ status: "not-started", count: counting.length }] : [];
  return BAR_STATUSES.map((status) => ({ status, count: counting.filter((b) => b.status === status).length })).filter(
    (segment) => segment.count > 0,
  );
}

/** The caption beside the document header's mini bar: the translated share, plus the needs-attention
 * count when there is one. */
export function documentCaption(progress: Progress, needsAttention: number): string {
  const blocks = `block${progress.total === 1 ? "" : "s"}`;
  const base = `${progress.translated}/${progress.total} ${blocks}`;
  return needsAttention > 0 ? `${base} · ${needsAttention} needs-attention` : base;
}
