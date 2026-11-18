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
});
