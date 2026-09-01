import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toString as nodeToString } from "mdast-util-to-string";
import {
  fingerprintBlock,
  isUntranslated,
  PLACEHOLDER_MARKER,
  parseBlocks,
  placeholderFor,
  splitBlocks,
  stringifyBlocks,
  translationProgress,
} from "./split-blocks.js";

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

  it("does not split list items out on their own (ADR-003)", () => {
    const nodes = parseBlocks("- one\n- two\n- three");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, "list");
  });
});

describe("fingerprintBlock", () => {
  it("is deterministic for the same content", () => {
    const [a] = parseBlocks("A paragraph.");
    const [b] = parseBlocks("A paragraph.");
    assert.equal(fingerprintBlock(a), fingerprintBlock(b));
  });

  it("is 16 hex characters long", () => {
    const [node] = parseBlocks("A paragraph.");
    assert.match(fingerprintBlock(node), /^[0-9a-f]{16}$/);
  });

  it("does not change for a purely cosmetic bullet-marker difference", () => {
    const [dash] = parseBlocks("- one\n- two");
    const [star] = parseBlocks("* one\n* two");
    assert.equal(fingerprintBlock(dash), fingerprintBlock(star));
  });

  it("does not change for a purely cosmetic emphasis-marker difference", () => {
    const [underscore] = parseBlocks("_italic_ text");
    const [asterisk] = parseBlocks("*italic* text");
    assert.equal(fingerprintBlock(underscore), fingerprintBlock(asterisk));
  });

  it("changes when the actual text changes", () => {
    const [a] = parseBlocks("A paragraph.");
    const [b] = parseBlocks("A different paragraph.");
    assert.notEqual(fingerprintBlock(a), fingerprintBlock(b));
  });
});

describe("splitBlocks", () => {
  it("assigns sequential zero-based indices matching each block's kind and fingerprint", () => {
    const markdown = "# Heading\n\nA paragraph.\n\n---";
    const blocks = splitBlocks(markdown);
    const nodes = parseBlocks(markdown);

    assert.equal(blocks.length, 3);
    blocks.forEach((block, i) => {
      assert.equal(block.index, i);
      assert.equal(block.kind, nodes[i].type);
      assert.equal(block.fingerprint, fingerprintBlock(nodes[i]));
    });
  });
});

describe("stringifyBlocks", () => {
  it("round-trips parsed nodes back into readable Markdown containing the original text", () => {
    const nodes = parseBlocks("# Heading\n\nA paragraph.");
    const markdown = stringifyBlocks(nodes);
    assert.equal(markdown, "# Heading\n\nA paragraph.\n");
  });
});

describe("placeholderFor", () => {
  it("keeps a heading's depth and prefixes the marker before a preview of its text", () => {
    const [node] = parseBlocks("## A Heading");
    const placeholder = placeholderFor(node);
    assert.ok(placeholder.type === "heading" && placeholder.depth === 2);
    const text = nodeToString(placeholder);
    assert.ok(text.startsWith(PLACEHOLDER_MARKER));
    assert.match(text, /A Heading$/);
  });

  it("keeps a list's ordered-ness", () => {
    const [ordered] = parseBlocks("1. one\n2. two");
    const [unordered] = parseBlocks("- one\n- two");
    const orderedPlaceholder = placeholderFor(ordered);
    const unorderedPlaceholder = placeholderFor(unordered);
    assert.ok(orderedPlaceholder.type === "list" && orderedPlaceholder.ordered === true);
    assert.ok(unorderedPlaceholder.type === "list" && unorderedPlaceholder.ordered === false);
  });

  it("keeps a code block's language", () => {
    const [node] = parseBlocks("```js\ncode();\n```");
    const placeholder = placeholderFor(node);
    assert.ok(placeholder.type === "code" && placeholder.lang === "js");
  });

  it("truncates a long preview at a word boundary with an ellipsis", () => {
    const longText = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const [node] = parseBlocks(longText);
    const placeholder = placeholderFor(node);
    const text = nodeToString(placeholder);
    assert.ok(text.endsWith("word11…"));
  });

  it("has no preview text for a thematic break", () => {
    const [node] = parseBlocks("---");
    assert.deepEqual(placeholderFor(node), { type: "thematicBreak" });
  });

  it("throws for an unsupported block kind", () => {
    assert.throws(() => placeholderFor({ type: "html", value: "<div></div>" }), /unsupported block kind/);
  });
});

describe("isUntranslated", () => {
  it("is true for a freshly generated placeholder", () => {
    const [node] = parseBlocks("A paragraph.");
    const [placeholder] = parseBlocks(stringifyBlocks([placeholderFor(node)]));
    assert.equal(isUntranslated(placeholder), true);
  });

  it("is false for real translated text", () => {
    const [node] = parseBlocks("Настоящий переведённый текст.");
    assert.equal(isUntranslated(node), false);
  });

  it("is true even after the preview text is gone, as long as the marker prefix remains", () => {
    const [node] = parseBlocks(`_${PLACEHOLDER_MARKER}_`);
    assert.equal(isUntranslated(node), true);
  });

  it("checks a code block's raw value, not its rendered text", () => {
    const [untranslated] = parseBlocks(`\`\`\`\n${PLACEHOLDER_MARKER} preview\n\`\`\``);
    const [translated] = parseBlocks("```\nreal code\n```");
    assert.equal(isUntranslated(untranslated), true);
    assert.equal(isUntranslated(translated), false);
  });
});

describe("translationProgress", () => {
  it("counts every block as untranslated when nothing has been translated yet", () => {
    const markdown = ["# H", "P."].join("\n\n");
    const progress = translationProgress(stringifyBlocks(parseBlocks(markdown).map(placeholderFor)));
    assert.equal(progress.total, 2);
    assert.equal(progress.translated, 0);
  });

  it("excludes thematic breaks from the total, so they never count as untranslated", () => {
    const progress = translationProgress("---\n\n---\n\n---");
    assert.deepEqual(progress, { translated: 0, total: 0 });
  });

  it("counts a mix of translated and untranslated blocks correctly", () => {
    const markdown = `Переведено.\n\n_${PLACEHOLDER_MARKER}_ preview`;
    assert.deepEqual(translationProgress(markdown), {
      translated: 1,
      total: 2,
    });
  });

  it("counts every block as translated once nothing holds the marker", () => {
    const markdown = "Один.\n\nДва.";
    assert.deepEqual(translationProgress(markdown), {
      translated: 2,
      total: 2,
    });
  });
});
