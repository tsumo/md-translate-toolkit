import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toString as nodeToString } from "mdast-util-to-string";
import { parseBlocks } from "./parse-blocks.js";
import { hasTranslatableContent, isUntranslated, PLACEHOLDER_MARKER } from "./placeholder.js";
import { fingerprintBlock, placeholderFor, splitBlocks, stringifyBlocks, translationProgress } from "./split-blocks.js";

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

  it("passes an html block of only markup through unchanged (ADR-018)", () => {
    const [node] = parseBlocks('<!-- p. 13 --><a id="page-13"></a>');
    assert.deepEqual(placeholderFor(node), node);
  });

  it("embeds the marker as an attribute on a translatable html block's first tag", () => {
    const [node] = parseBlocks('<div class="spell">\nSome text\n</div>');
    const placeholder = placeholderFor(node);
    assert.ok(placeholder.type === "html");
    assert.ok(placeholder.value.startsWith('<div class="spell" data-untranslated="(не переведено)">'));
    assert.ok(placeholder.value.endsWith("Some text\n</div>"));
  });

  it("injects the marker before the slash of a self-closing first tag", () => {
    const placeholder = placeholderFor({ type: "html", value: '<hr class="sep"/>Some text' });
    assert.ok(placeholder.type === "html");
    assert.match(placeholder.value, /^<hr class="sep" data-untranslated="\(не переведено\)" \/>/);
  });

  it("round-trips a translatable html placeholder as one html block, so positions keep matching", () => {
    const [node] = parseBlocks('<div class="spell">\nSome text\n</div>');
    const [reparsed] = parseBlocks(stringifyBlocks([placeholderFor(node)]));
    assert.equal(reparsed.type, "html");
    assert.equal(isUntranslated(reparsed), true);
  });

  it("round-trips a pre block placeholder as one html block, with the marker inside its opening tag", () => {
    const [node] = parseBlocks('<pre class="snippet">\ncode();\n</pre>');
    const [reparsed] = parseBlocks(stringifyBlocks([placeholderFor(node)]));
    assert.equal(reparsed.type, "html");
    assert.equal(isUntranslated(reparsed), true);
    assert.ok(reparsed.type === "html" && reparsed.value.endsWith("code();\n</pre>"));
  });

  it("round-trips a placeholder of a comment-fused line as one html block, marker on the tag after the comment", () => {
    const [node] = parseBlocks("<!-- p. 13 --><div>Some text</div>");
    const [reparsed] = parseBlocks(stringifyBlocks([placeholderFor(node)]));
    assert.equal(reparsed.type, "html");
    assert.ok(reparsed.type === "html" && reparsed.value.includes("<div data-untranslated="));
  });

  it("throws for an unsupported block kind", () => {
    assert.throws(
      () => placeholderFor({ type: "definition", identifier: "ref", url: "https://example.com", title: null }),
      /unsupported block kind/,
    );
  });

  it("throws for a translatable html value with no open tag to carry the marker", () => {
    assert.throws(() => placeholderFor({ type: "html", value: "</div>\nSome text" }), /unsupported html block shape/);
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

  it("detects the marker attribute on an html block's first tag", () => {
    const [untranslated] = parseBlocks(`<div data-untranslated="${PLACEHOLDER_MARKER}">Some text</div>`);
    assert.equal(isUntranslated(untranslated), true);
    const [translated] = parseBlocks("<div>Переведённый текст</div>");
    assert.equal(isUntranslated(translated), false);
  });

  it("is false for an html block of pure markup", () => {
    const [node] = parseBlocks('<!-- p. 13 --><a id="page-13"></a>');
    assert.equal(isUntranslated(node), false);
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

  it("excludes a structural html block from the total, like a divider (ADR-018)", () => {
    const progress = translationProgress('---\n\n<!-- p. 13 --><a id="page-13"></a>');
    assert.deepEqual(progress, { translated: 0, total: 0 });
  });

  it("counts a translatable html placeholder as untranslated until its marker is gone", () => {
    const [node] = parseBlocks("<div>Some text</div>");
    assert.deepEqual(translationProgress(stringifyBlocks([placeholderFor(node)])), { translated: 0, total: 1 });
    assert.deepEqual(translationProgress("<div>Переведённый текст</div>"), { translated: 1, total: 1 });
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
