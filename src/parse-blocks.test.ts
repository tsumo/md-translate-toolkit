import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBlocks } from "./parse-blocks.js";

describe("parseBlocks", () => {
  it("splits each top-level construct into its own block, in order", () => {
    const markdown = [
      "# Heading",
      "",
      "A paragraph.",
      "",
      "> A blockquote.",
      "",
      "- a list item",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```js",
      "code();",
      "```",
      "",
      "---",
    ].join("\n");

    const kinds = parseBlocks(markdown).map((node) => node.type);
    assert.deepEqual(kinds, ["heading", "paragraph", "blockquote", "list", "table", "code", "thematicBreak"]);
  });

  it("does not split list items out on their own (ADR-002)", () => {
    const nodes = parseBlocks("- one\n- two\n- three");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, "list");
  });

  it("parses a fused page-anchor line as one raw HTML block", () => {
    const [node] = parseBlocks('<!-- p. 13 --><a id="page-13"></a>');
    assert.equal(node.type, "html");
  });

  it("parses two adjacent anchor lines as two raw HTML blocks", () => {
    const nodes = parseBlocks('<!-- p. 156 --><a id="page-156"></a>\n<!-- p. 157 --><a id="page-157"></a>');
    assert.deepEqual(
      nodes.map((node) => node.type),
      ["html", "html"],
    );
  });

  it("parses a multi-line div as one raw HTML block", () => {
    const nodes = parseBlocks('<div class="spell">\nSome text\n</div>');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, "html");
  });
});
