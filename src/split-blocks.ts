/**
 * Fingerprints top-level blocks (ADR-011) and makes placeholder blocks for translation skeletons (ADR-006).
 * The same code handles originals and translations.
 */
import { createHash } from "node:crypto";
import type { Root, RootContent } from "mdast";
import { toString as nodeToString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { parseBlocks } from "./parse-blocks.js";
import type { BlockEntry } from "./types.js";

/** Block data that comes from content only. It has no status. */
export type ContentBlock = Pick<BlockEntry, "kind" | "fingerprint">;

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

const PREVIEW_MAX_CHARS = 80;

/** Cuts `text` to about `maxChars` characters, at a word boundary. */
function truncatePreview(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  const cut = collapsed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function previewText(node: RootContent): string {
  return truncatePreview(nodeToString(node, { includeHtml: false }), PREVIEW_MAX_CHARS);
}

/**
 * The preview placeholder of `node`, built by `make` from the preview text. A block whose preview is empty,
 * such as a paragraph that holds only an image, passes through unchanged, because an empty placeholder would
 * vanish on re-parse and break the block alignment (ADR-005).
 */
function previewPlaceholder(node: RootContent, make: (preview: string) => RootContent): RootContent {
  const preview = previewText(node);
  return preview ? make(preview) : node;
}

/**
 * Makes a placeholder of the same kind as `node`: a bare preview of the original text (ADR-006). It keeps
 * cheap structure, such as heading depth, list type, and code language. It does not copy nested content,
 * because blocks are top-level only (ADR-002). The block's untranslated status, not its text, says that it
 * is untranslated (ADR-010).
 */
export function placeholderFor(node: RootContent): RootContent {
  switch (node.type) {
    case "heading":
      return previewPlaceholder(node, (preview) => ({
        type: "heading",
        depth: node.depth,
        children: [{ type: "text", value: preview }],
      }));
    case "paragraph":
      return previewPlaceholder(node, (preview) => ({
        type: "paragraph",
        children: [{ type: "text", value: preview }],
      }));
    case "blockquote":
      return previewPlaceholder(node, (preview) => ({
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: preview }] }],
      }));
    case "list":
      return previewPlaceholder(node, (preview) => ({
        type: "list",
        ordered: node.ordered ?? false,
        children: [
          { type: "listItem", children: [{ type: "paragraph", children: [{ type: "text", value: preview }] }] },
        ],
      }));
    case "table":
      return previewPlaceholder(node, (preview) => ({
        type: "table",
        align: [null],
        children: [
          { type: "tableRow", children: [{ type: "tableCell", children: [{ type: "text", value: preview }] }] },
        ],
      }));
    case "code":
      return {
        type: "code",
        lang: node.lang ?? undefined,
        value: previewText(node),
      };
    case "thematicBreak":
      return { type: "thematicBreak" };
    case "html":
      // The placeholder is the original markup verbatim (ADR-006): a person translates such a block in place.
      return node;
    default:
      throw new Error(`placeholderFor: unsupported block kind "${node.type}" — add support once seen in a real file.`);
  }
}
