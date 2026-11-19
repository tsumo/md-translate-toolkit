/**
 * Placeholder blocks: the untranslated marker, its detection, and the bare skeletons the inline block editor
 * prefills. This module uses no Node-only APIs, so the client can bundle it.
 */
import type { RootContent } from "mdast";
import { toString as nodeToString } from "mdast-util-to-string";
import { parseBlocks } from "./parse-blocks.js";

/** Marks a block as untranslated. A block is untranslated when its text starts with this (ADR-006). */
export const PLACEHOLDER_MARKER = "(не переведено)";

/** True when the text of `node` starts with the marker. */
export function isUntranslated(node: RootContent): boolean {
  const text = node.type === "code" ? node.value : nodeToString(node);
  return text.startsWith(PLACEHOLDER_MARKER);
}

/**
 * The text the inline block editor opens with: real content as-is whatever its status, a structural
 * placeholder as a bare skeleton of its kind — no marker and no preview, so the submission keeps the
 * required block kind without editing the placeholder text — and every other placeholder empty.
 */
export function prefillForBlock(source: string): string {
  const [block] = parseBlocks(source);
  if (!block || !isUntranslated(block)) return source;
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.depth)} `;
    case "code":
      return `\`\`\`${block.lang ?? ""}\n\`\`\``;
    case "list":
      return block.ordered ? "1. " : "- ";
    case "blockquote":
      return "> ";
    case "table":
      return "|  |\n| - |";
    default:
      return "";
  }
}
