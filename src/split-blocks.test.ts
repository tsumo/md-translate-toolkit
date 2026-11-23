import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toString as nodeToString } from "mdast-util-to-string";
import { parseBlocks } from "./parse-blocks.js";
import { hasTranslatableContent } from "./placeholder.js";
import { fingerprintBlock, placeholderFor, splitBlocks, stringifyBlocks } from "./split-blocks.js";

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
  it("returns one entry per block, in order, matching its kind and fingerprint", () => {
    const markdown = "# Heading\n\nA paragraph.\n\n---";
    const blocks = splitBlocks(markdown);
    const nodes = parseBlocks(markdown);

    assert.equal(blocks.length, 3);
    blocks.forEach((block, i) => {
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
  it("keeps a heading's depth and gives a bare preview of its text, with no marker", () => {
    const [node] = parseBlocks("## A Heading");
    const placeholder = placeholderFor(node);
    assert.ok(placeholder.type === "heading" && placeholder.depth === 2);
    assert.equal(nodeToString(placeholder), "A Heading");
  });

  it("gives a paragraph placeholder only the preview text", () => {
    const [node] = parseBlocks("Оригинальный текст.");
    const placeholder = placeholderFor(node);
    assert.equal(nodeToString(placeholder), "Оригинальный текст.");
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
    assert.ok(placeholder.type === "code" && placeholder.value === "code();");
  });

  it("truncates a long preview at a word boundary with an ellipsis", () => {
    const longText = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const [node] = parseBlocks(longText);
    const placeholder = placeholderFor(node);
    assert.ok(nodeToString(placeholder).endsWith("word11…"));
  });

  it("has no preview text for a thematic break", () => {
    const [node] = parseBlocks("---");
    assert.deepEqual(placeholderFor(node), { type: "thematicBreak" });
  });

  it("passes any html block through unchanged, whatever its content (ADR-006)", () => {
    const [anchor] = parseBlocks('<!-- p. 13 --><a id="page-13"></a>');
    assert.deepEqual(placeholderFor(anchor), anchor);
    const [div] = parseBlocks('<div class="spell">\nSome text\n</div>');
    assert.deepEqual(placeholderFor(div), div);
  });

  it("round-trips an html placeholder as one html block, so positions keep matching", () => {
    const [node] = parseBlocks('<div class="spell">\nSome text\n</div>');
    const [reparsed] = parseBlocks(stringifyBlocks([placeholderFor(node)]));
    assert.equal(reparsed.type, "html");
    assert.ok(reparsed.type === "html" && reparsed.value.includes("Some text"));
  });

  it("round-trips a pre block placeholder as one html block", () => {
    const [node] = parseBlocks('<pre class="snippet">\ncode();\n</pre>');
    const [reparsed] = parseBlocks(stringifyBlocks([placeholderFor(node)]));
    assert.equal(reparsed.type, "html");
    assert.ok(reparsed.type === "html" && reparsed.value.endsWith("code();\n</pre>"));
  });

  it("falls back to the original block when its preview is empty, so alignment never breaks", () => {
    // A paragraph holding only an image has no text, so its preview is empty. An empty
    // placeholder would vanish on re-parse; the original keeps one block of the same kind.
    const [node] = parseBlocks("![](img.png)");
    assert.deepEqual(placeholderFor(node), node);
    const roundTripped = parseBlocks(stringifyBlocks([placeholderFor(node)]));
    assert.equal(roundTripped.length, 1);
    assert.equal(roundTripped[0].type, "paragraph");
  });

  it("throws for an unsupported block kind", () => {
    assert.throws(
      () => placeholderFor({ type: "definition", identifier: "ref", url: "https://example.com", title: null }),
      /unsupported block kind/,
    );
  });
});

describe("hasTranslatableContent", () => {
  it("is false for a divider", () => {
    const [node] = parseBlocks("---");
    assert.equal(hasTranslatableContent(node), false);
  });

  it("is false for an html block of only comments and tags", () => {
    const [node] = parseBlocks('<!-- p. 13 --><a id="page-13"></a>');
    assert.equal(hasTranslatableContent(node), false);
  });

  it("is false for a standalone html comment", () => {
    const [node] = parseBlocks("<!-- back cover -->");
    assert.equal(hasTranslatableContent(node), false);
  });

  it("is true for an html block with text inside its tags", () => {
    const [node] = parseBlocks("<div>Some text</div>");
    assert.equal(hasTranslatableContent(node), true);
  });

  it("is true for every other block kind", () => {
    const markdown = ["# H", "P.", "> Q.", "- L.", "| a | b |", "| - | - |", "```js", "code();", "```"].join("\n\n");
    assert.ok(parseBlocks(markdown).every(hasTranslatableContent));
  });
});
