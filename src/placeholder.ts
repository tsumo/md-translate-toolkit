/**
 * Placeholder blocks: the untranslated marker, its detection, and the bare skeletons the inline block editor
 * prefills. This module uses no Node-only APIs, so the client can bundle it.
 */
import type { RootContent } from "mdast";
import { toString as nodeToString } from "mdast-util-to-string";
import { parseBlocks } from "./parse-blocks.js";

/** Marks a block as untranslated. A block is untranslated when its text starts with this (ADR-006). */
export const PLACEHOLDER_MARKER = "(не переведено)";

/** The marker as an HTML attribute. A raw HTML placeholder carries it on its first tag (ADR-006), so the
 * block keeps its kind and its one-block shape whatever HTML construct it is. */
export const HTML_MARKER_ATTRIBUTE = `data-untranslated="${PLACEHOLDER_MARKER}"`;

/** True when the text of `node` starts with the marker. A raw HTML block is untranslated while its value
 * carries the marker attribute. */
export function isUntranslated(node: RootContent): boolean {
  if (node.type === "html") return node.value.includes(HTML_MARKER_ATTRIBUTE);
  const text = node.type === "code" ? node.value : nodeToString(node);
  return text.startsWith(PLACEHOLDER_MARKER);
}

/**
 * Puts the marker attribute on the first open tag of an HTML value, before the tag's `>` (before the `/>` of
 * a self-closing tag). The first tag sits on the value's first line, inside the HTML block, so the marked
 * value still re-parses as one block of the same kind. Returns `undefined` when no open tag can carry the
 * attribute, such as a value starting with a closing tag or a processing instruction. Like the tag-strip
 * content check, the tag search does not look inside quoted attribute values.
 */
export function injectHtmlMarker(value: string): string | undefined {
  const match = /<[a-zA-Z][^>]*>/.exec(value);
  if (!match) return undefined;
  const selfClosing = match[0].endsWith("/>");
  const head = selfClosing ? match[0].slice(0, -2) : match[0].slice(0, -1);
  const tail = selfClosing ? " />" : ">";
  return (
    value.slice(0, match.index) + `${head} ${HTML_MARKER_ATTRIBUTE}${tail}` + value.slice(match.index + match[0].length)
  );
}

/**
 * True when a block carries text a person could translate (ADR-018). A divider has none. A raw HTML block
 * whose value holds only comments and tags has none. Every other kind carries text.
 */
export function hasTranslatableContent(node: RootContent): boolean {
  if (node.type === "thematicBreak") return false;
  if (node.type !== "html") return true;
  const text = node.value.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
  return /\S/.test(text);
}

/**
 * The text the inline block editor opens with: real content as-is whatever its status, a structural
 * placeholder as a bare skeleton of its kind — no marker and no preview, so the submission keeps the
 * required block kind without editing the placeholder text — an HTML placeholder as its original markup
 * without the marker attribute, for translation in place, and every other placeholder empty.
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
    case "html":
      return block.value.replace(` ${HTML_MARKER_ATTRIBUTE}`, "");
    default:
      return "";
  }
}
