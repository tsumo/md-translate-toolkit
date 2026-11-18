/**
 * Parses Markdown into top-level blocks. This module uses no Node-only APIs, so the inline block editor can
 * bundle it into the client.
 */
import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);

/** Parses Markdown into top-level block nodes. */
export function parseBlocks(markdown: string): RootContent[] {
  const tree = parser.parse(markdown) as Root;
  return tree.children;
}
