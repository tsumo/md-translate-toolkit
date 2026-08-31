/**
 * Parses a Markdown document into its top-level blocks, fingerprints them
 * (ADR-017), and generates neutral placeholder blocks for translation
 * skeletons (ADR-007). Used identically on originals and translations —
 * same splitter, no special-casing (see TODO.md Phase 2).
 */
import { createHash } from "node:crypto";
import type { PhrasingContent, Root, RootContent } from "mdast";
import { toString as nodeToString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { BlockEntry } from "./types.js";

/** Purely content-derived block data — no status, which is human-owned. */
export type ContentBlock = Pick<BlockEntry, "index" | "kind" | "fingerprint">;

const parser = unified().use(remarkParse).use(remarkGfm);

/** Parse Markdown into its top-level block nodes (headings, paragraphs, lists, etc.). */
export function parseBlocks(markdown: string): RootContent[] {
  const tree = parser.parse(markdown) as Root;
  return tree.children;
}

// Fixed, normalized stringify options for fingerprinting (ADR-017): canonicalizes
// formatting so purely cosmetic upstream edits don't change the fingerprint.
const normalizedStringify = unified()
  .use(remarkStringify, { bullet: "-", emphasis: "_", strong: "*", fence: "`", rule: "-" })
  .use(remarkGfm);

/** sha256 of the block's normalized re-serialization, truncated to 16 hex chars (ADR-017). */
export function fingerprintBlock(node: RootContent): string {
  const root: Root = { type: "root", children: [node] };
  const text = normalizedStringify.stringify(root);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Full block list + fingerprints for a document, in original order. */
export function splitBlocks(markdown: string): ContentBlock[] {
  return parseBlocks(markdown).map((node, index) => ({
    index,
    kind: node.type,
    fingerprint: fingerprintBlock(node),
  }));
}

// Human-facing stringify (default formatting) for generated skeleton/output files.
const readableStringify = unified().use(remarkStringify).use(remarkGfm);

/** Render a list of top-level nodes back to readable Markdown. */
export function stringifyBlocks(nodes: RootContent[]): string {
  const root: Root = { type: "root", children: nodes };
  return readableStringify.stringify(root);
}

/** Untranslated-block marker (ADR-005, ADR-007). A block is untranslated iff its text starts with this. */
export const PLACEHOLDER_MARKER = "(не переведено)";

const PREVIEW_MAX_CHARS = 80;

/** Truncate `text` to roughly `maxChars`, cutting at a word boundary. */
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

/** `[marker, preview text]` as phrasing content, or just `[marker]` if there's no text to preview. */
function markerWithPreview(node: RootContent): PhrasingContent[] {
  const preview = truncatePreview(nodeToString(node, { includeHtml: false }), PREVIEW_MAX_CHARS);
  return preview
    ? [emphasized(PLACEHOLDER_MARKER), { type: "text", value: ` ${preview}` }]
    : [emphasized(PLACEHOLDER_MARKER)];
}

/**
 * A placeholder node of the same kind as `node`: the marker plus a
 * truncated preview of the original's text (ADR-005, ADR-007). Preserves
 * structural detail that's cheap to keep (heading depth, list
 * ordered-ness, code language) without deep-cloning nested content —
 * blocks are tracked at the top level only (ADR-003).
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

/** True iff `node`'s text still starts with the untranslated marker. */
export function isUntranslated(node: RootContent): boolean {
  const text = node.type === "code" ? node.value : nodeToString(node);
  return text.startsWith(PLACEHOLDER_MARKER);
}

/** Content-derived progress: how many blocks are untranslated vs. total. */
export function translationProgress(markdown: string): { translated: number; total: number } {
  const nodes = parseBlocks(markdown);
  const translated = nodes.filter((node) => !isUntranslated(node)).length;
  return { translated, total: nodes.length };
}
