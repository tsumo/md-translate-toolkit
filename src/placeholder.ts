/**
 * Placeholder helpers and the bare skeletons the inline block editor prefills. This module uses no Node-only
 * APIs, so the client can bundle it.
 */
import type { RootContent } from "mdast";
import { parseBlocks } from "./parse-blocks.js";
import type { BlockStatus } from "./types.js";

/**
 * True when a block carries text a person could translate (ADR-017). A divider has none. A raw HTML block
 * whose value holds only comments and tags has none. Every other kind carries text.
 */
export function hasTranslatableContent(node: RootContent): boolean {
  if (node.type === "thematicBreak") return false;
  if (node.type !== "html") return true;
  const text = node.value.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
  return /\S/.test(text);
}

/**
 * The text the inline block editor opens with: real content as-is whatever its status, and an untranslated
 * placeholder as a bare skeleton of its kind — no preview text, so the submission keeps the required block
 * kind without editing the placeholder text. A raw HTML placeholder is its original markup, for translation
 * in place. Every other kind opens empty.
 */
export function prefillForBlock(source: string, status: BlockStatus): string {
  const [block] = parseBlocks(source);
  if (!block || status !== "untranslated") return source;
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
    case "html":
      return source;
    default:
      return "";
  }
}
