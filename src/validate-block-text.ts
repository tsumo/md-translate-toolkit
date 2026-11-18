/**
 * The submission rule of the inline block editor: edited block text must form exactly one top-level block
 * with real text. The client checks before sending and the dev server checks again on receipt,
 * so both import this module. It uses no Node-only APIs.
 */

import type { RootContent } from "mdast";
import { toString as nodeToString } from "mdast-util-to-string";
import { parseBlocks } from "./parse-blocks.js";

/** True when the block has text beyond whitespace. The plain text of a code block is its value. */
function hasText(block: RootContent): boolean {
  return nodeToString(block).trim().length > 0;
}

/**
 * Checks text that would replace one block: it must parse to exactly one top-level block of `expectedKind`
 * with non-whitespace text. Returns the rejection reason, so the editor can show it where the text was typed.
 */
export function validateBlockText(text: string, expectedKind: string): { ok: true } | { ok: false; error: string } {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) {
    return { ok: false, error: "The text is empty or whitespace-only." };
  }
  if (blocks.length > 1) {
    const kinds = blocks.map((block) => block.type).join(", ");
    return {
      ok: false,
      error: `The text forms ${blocks.length} blocks (${kinds}), but an edit must replace exactly one block.`,
    };
  }
  const [block] = blocks;
  if (block.type !== expectedKind) {
    return {
      ok: false,
      error: `The text forms a ${block.type} block, but the block at this position is a ${expectedKind}.`,
    };
  }
  if (!hasText(block)) {
    return {
      ok: false,
      error: `The ${expectedKind} block has no text. Fill in its text, not just the Markdown skeleton.`,
    };
  }
  return { ok: true };
}
