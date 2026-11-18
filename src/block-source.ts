/**
 * The exact raw Markdown source of one top-level block in a document, and the splice that replaces
 * it in place. The dev server uses these to hand a block to the inline block editor and to write an
 * edit back into the translation file. It uses no Node-only APIs.
 */
import type { RootContent } from "mdast";
import { parseBlocks } from "./parse-blocks.js";

/** The character offsets of the block at `index` in `markdown`. */
function blockOffsets(markdown: string, index: number): { start: number; end: number } {
  const node: RootContent | undefined = parseBlocks(markdown)[index];
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`No block with source offsets at index ${index}.`);
  }
  return { start, end };
}

/** The exact raw Markdown of the block at `index`, without the blank lines around it. */
export function rawBlockSource(markdown: string, index: number): string {
  const { start, end } = blockOffsets(markdown, index);
  return markdown.slice(start, end);
}

/**
 * Replaces the raw Markdown of the block at `index` with `text`. Everything outside the block's own source
 * stays byte-identical, so the other blocks never change.
 */
export function replaceBlockSource(markdown: string, index: number, text: string): string {
  const { start, end } = blockOffsets(markdown, index);
  return markdown.slice(0, start) + text + markdown.slice(end);
}
