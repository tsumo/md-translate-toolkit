/**
 * Splits Markdown into top-level blocks, fingerprints them (ADR-011), and makes placeholder blocks for
 * translation skeletons (ADR-006). The same code handles originals and translations.
 */
import { createHash } from "node:crypto";
import type { PhrasingContent, Root, RootContent } from "mdast";
import { toString as nodeToString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { BlockEntry } from "./types.js";

/** Block data that comes from content only. It has no status. */
export type ContentBlock = Pick<BlockEntry, "kind" | "fingerprint">;

const parser = unified().use(remarkParse).use(remarkGfm);

/** Parses Markdown into top-level block nodes. */
export function parseBlocks(markdown: string): RootContent[] {
  const tree = parser.parse(markdown) as Root;
  return tree.children;
}

// Fixed output options, so cosmetic upstream edits do not change a fingerprint (ADR-011).
const normalizedStringify = unified()
  .use(remarkStringify, { bullet: "-", emphasis: "_", strong: "*", fence: "`", rule: "-" })
  .use(remarkGfm);

/** The first 16 hex characters of the sha256 of the normalized text of the block. */
export function fingerprintBlock(node: RootContent): string {
  const root: Root = { type: "root", children: [node] };
  const text = normalizedStringify.stringify(root);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Every block of a document, in order, with its fingerprint. */
export function splitBlocks(markdown: string): ContentBlock[] {
  return parseBlocks(markdown).map((node) => ({
    kind: node.type,
    fingerprint: fingerprintBlock(node),
  }));
}

// Default formatting, for files that people read.
const readableStringify = unified().use(remarkStringify).use(remarkGfm);

/** Writes top-level nodes back to Markdown. */
export function stringifyBlocks(nodes: RootContent[]): string {
  const root: Root = { type: "root", children: nodes };
  return readableStringify.stringify(root);
}

/** Marks a block as untranslated. A block is untranslated when its text starts with this (ADR-006). */
export const PLACEHOLDER_MARKER = "(не переведено)";

const PREVIEW_MAX_CHARS = 80;

/** Cuts `text` to about `maxChars` characters, at a word boundary. */
function truncatePreview(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  const cut = collapsed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function emphasized(text: string): PhrasingContent {
  return { type: "emphasis", children: [{ type: "text", value: text }] };
}

/** The marker plus a preview of the block text. Only the marker, when the block has no text. */
function markerWithPreview(node: RootContent): PhrasingContent[] {
  const preview = truncatePreview(nodeToString(node, { includeHtml: false }), PREVIEW_MAX_CHARS);
  return preview
    ? [emphasized(PLACEHOLDER_MARKER), { type: "text", value: ` ${preview}` }]
    : [emphasized(PLACEHOLDER_MARKER)];
}

/**
 * Makes a placeholder of the same kind as `node`: the marker plus a preview of the original text (ADR-006).
 * It keeps cheap structure, such as heading depth, list type, and code language. It does not copy nested
 * content, because blocks are top-level only (ADR-002).
 */
export function placeholderFor(node: RootContent): RootContent {
  switch (node.type) {
    case "heading":
      return { type: "heading", depth: node.depth, children: markerWithPreview(node) };
    case "paragraph":
      return { type: "paragraph", children: markerWithPreview(node) };
    case "blockquote":
      return {
        type: "blockquote",
        children: [{ type: "paragraph", children: markerWithPreview(node) }],
      };
    case "list":
      return {
        type: "list",
        ordered: node.ordered ?? false,
        children: [{ type: "listItem", children: [{ type: "paragraph", children: markerWithPreview(node) }] }],
      };
    case "table":
      return {
        type: "table",
        align: [null],
        children: [{ type: "tableRow", children: [{ type: "tableCell", children: markerWithPreview(node) }] }],
      };
    case "code": {
      const preview = truncatePreview(node.value, PREVIEW_MAX_CHARS);
      return {
        type: "code",
        lang: node.lang ?? undefined,
        value: preview ? `${PLACEHOLDER_MARKER} ${preview}` : PLACEHOLDER_MARKER,
      };
    }
    case "thematicBreak":
      return { type: "thematicBreak" };
    default:
      throw new Error(`placeholderFor: unsupported block kind "${node.type}" — add support once seen in a real file.`);
  }
}

/** True when the text of `node` starts with the marker. */
export function isUntranslated(node: RootContent): boolean {
  const text = node.type === "code" ? node.value : nodeToString(node);
  return text.startsWith(PLACEHOLDER_MARKER);
}

/** Counts translated blocks and all blocks. Dividers have no text, so it skips them. */
export function translationProgress(markdown: string): { translated: number; total: number } {
  const nodes = parseBlocks(markdown).filter((node) => node.type !== "thematicBreak");
  const translated = nodes.filter((node) => !isUntranslated(node)).length;
  return { translated, total: nodes.length };
}
