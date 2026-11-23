import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSync } from "esbuild";
import { prefillForBlock } from "./placeholder.js";

describe("prefillForBlock", () => {
  it("returns real content as-is, whatever its status", () => {
    const source = "Переведённый абзац.";
    assert.equal(prefillForBlock(source, "complete"), source);
  });

  it("returns a block as-is when its status is not untranslated", () => {
    const source = "# Заголовок над готовым переводом.";
    assert.equal(prefillForBlock(source, "verified"), source);
    assert.equal(prefillForBlock(source, "in-progress"), source);
    assert.equal(prefillForBlock(source, "needs-attention"), source);
  });

  it("opens a paragraph placeholder empty", () => {
    assert.equal(prefillForBlock("Оригинальный текст.", "untranslated"), "");
  });

  it("opens a heading placeholder with only its depth marker", () => {
    assert.equal(prefillForBlock("# A Heading", "untranslated"), "# ");
    assert.equal(prefillForBlock("### A Deeper Heading", "untranslated"), "### ");
  });

  it("opens a code placeholder with an empty fence keeping the language", () => {
    assert.equal(prefillForBlock("```js\ncode();\n```", "untranslated"), "```js\n```");
  });

  it("opens a language-less code placeholder with a bare fence", () => {
    assert.equal(prefillForBlock("```\ncode();\n```", "untranslated"), "```\n```");
  });

  it("opens a list placeholder with only its marker", () => {
    assert.equal(prefillForBlock("- пункт один\n- пункт два", "untranslated"), "- ");
    assert.equal(prefillForBlock("1. пункт один\n2. пункт два", "untranslated"), "1. ");
  });

  it("opens a quote placeholder with only the quote marker", () => {
    assert.equal(prefillForBlock("> Цитата целиком.", "untranslated"), "> ");
  });

  it("opens a table placeholder with a minimal one-column table", () => {
    assert.equal(prefillForBlock("| a | b |\n| - | - |\n| 1 | 2 |", "untranslated"), "|  |\n| - |");
  });

  it("opens an untranslated html placeholder with its original markup, for translation in place", () => {
    const source = '<div class="note">A note to translate.</div>';
    assert.equal(prefillForBlock(source, "untranslated"), source);
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
