import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSync } from "esbuild";
import { parseBlocks } from "./parse-blocks.js";
import { prefillForBlock } from "./placeholder.js";
import { placeholderFor, stringifyBlocks } from "./split-blocks.js";

/** A real placeholder's source, the way `add-source` writes it into a translation file. */
function placeholderSource(original: string): string {
  return stringifyBlocks(parseBlocks(original).map(placeholderFor));
}

describe("prefillForBlock", () => {
  it("returns real content as-is, whatever its source", () => {
    const source = "Переведённый абзац.";
    assert.equal(prefillForBlock(source), source);
  });

  it("returns a translated code block as-is, not a bare fence", () => {
    const source = "```js\nпереведённыйКод();\n```";
    assert.equal(prefillForBlock(source), source);
  });

  it("opens a paragraph placeholder empty, without marker or preview", () => {
    assert.equal(prefillForBlock(placeholderSource("Оригинальный текст.")), "");
  });

  it("opens a heading placeholder with only its depth marker", () => {
    assert.equal(prefillForBlock(placeholderSource("# A Heading")), "# ");
    assert.equal(prefillForBlock(placeholderSource("### A Deeper Heading")), "### ");
  });

  it("opens a code placeholder with an empty fence keeping the language", () => {
    assert.equal(prefillForBlock(placeholderSource("```js\ncode();\n```")), "```js\n```");
  });

  it("opens a language-less code placeholder with a bare fence", () => {
    assert.equal(prefillForBlock(placeholderSource("```\ncode();\n```")), "```\n```");
  });

  it("opens a list placeholder with only its marker", () => {
    assert.equal(prefillForBlock(placeholderSource("- пункт один\n- пункт два")), "- ");
    assert.equal(prefillForBlock(placeholderSource("1. пункт один\n2. пункт два")), "1. ");
  });

  it("opens a quote placeholder with only the quote marker", () => {
    assert.equal(prefillForBlock(placeholderSource("> Цитата целиком.")), "> ");
  });

  it("opens a table placeholder with a minimal one-column table", () => {
    assert.equal(prefillForBlock(placeholderSource("| a | b |\n| - | - |\n| 1 | 2 |")), "|  |\n| - |");
  });
});

describe("placeholder module client bundle", () => {
  // The inline block editor prefills from this module, so it must bundle for the browser (the way `dev`
  // bundles `src/client/main.ts`). A Node-only import anywhere in its graph fails here.
  it("bundles for the browser with no unresolved imports", () => {
    const result = buildSync({
      entryPoints: [`${import.meta.dirname}/placeholder.ts`],
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      logLevel: "silent",
    });
    assert.equal(result.warnings.length, 0);
    assert.ok(result.outputFiles[0].text.includes("prefillForBlock"));
  });
});
