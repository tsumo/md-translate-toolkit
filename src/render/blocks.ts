/** Converts Markdown blocks to HTML. */
import type { Root as HastRoot } from "hast";
import type { Root, RootContent } from "mdast";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const toHast = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeSlug);
const stringifyHast = unified().use(rehypeStringify, { allowDangerousHtml: true });

/**
 * Converts a document to HTML, one string per block. Heading IDs need the whole document, so this converts
 * the whole tree once and then splits the result into blocks.
 */
export function documentToBlockHtml(nodes: RootContent[]): string[] {
  const mdastRoot: Root = { type: "root", children: nodes };
  const hastRoot = toHast.runSync(mdastRoot) as HastRoot;
  // remark-rehype adds blank text nodes between blocks. Drop them, or the block indices shift.
  const blocks = hastRoot.children.filter((child) => child.type !== "text" || child.value.trim() !== "");
  return blocks.map((child) => stringifyHast.stringify({ type: "root", children: [child] }));
}
