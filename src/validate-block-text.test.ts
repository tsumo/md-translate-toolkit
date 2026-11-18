import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSync } from "esbuild";
import { validateBlockText } from "./validate-block-text.js";

/** The result of every accepted text. */
const ACCEPTED = { ok: true };

describe("validateBlockText", () => {
  it("accepts a paragraph", () => {
    assert.deepEqual(validateBlockText("Один переведённый абзац.", "paragraph"), ACCEPTED);
  });

  it("accepts a heading of any depth", () => {
    assert.deepEqual(validateBlockText("# Заголовок", "heading"), ACCEPTED);
    assert.deepEqual(validateBlockText("## Заголовок раздела", "heading"), ACCEPTED);
    assert.deepEqual(validateBlockText("###### Заголовок в глубине", "heading"), ACCEPTED);
  });

  it("accepts a whole list as one block", () => {
    const list = ["1. первый пункт", "2. второй пункт", "3. третий пункт"].join("\n");
    assert.deepEqual(validateBlockText(list, "list"), ACCEPTED);
  });

  it("accepts a table", () => {
    const table = ["| заклинание | уровень |", "| --- | --- |", "| огненный шар | 3 |"].join("\n");
    assert.deepEqual(validateBlockText(table, "table"), ACCEPTED);
  });

  it("accepts a quote", () => {
    assert.deepEqual(validateBlockText("> Цитата в одну строку.", "blockquote"), ACCEPTED);
  });

  it("accepts a code block with a language", () => {
    assert.deepEqual(validateBlockText("```js\nкод();\n```", "code"), ACCEPTED);
  });

  it("accepts one block with blank lines around it", () => {
    assert.deepEqual(validateBlockText("\n\nПереведённый абзац.\n\n", "paragraph"), ACCEPTED);
  });

  it("rejects a block of the wrong kind, naming both kinds", () => {
    const result = validateBlockText("# Заголовок вместо абзаца", "paragraph");
    assert.ok(!result.ok);
    assert.match(result.error, /heading/);
    assert.match(result.error, /paragraph/);
  });

  it("rejects a paragraph submitted for a heading position", () => {
    const result = validateBlockText("Просто абзац.", "heading");
    assert.ok(!result.ok);
    assert.match(result.error, /paragraph/);
    assert.match(result.error, /heading/);
  });

  it("rejects empty text", () => {
    assert.ok(!validateBlockText("", "paragraph").ok);
  });

  it("rejects whitespace-only text", () => {
    assert.ok(!validateBlockText("   \n\n  ", "paragraph").ok);
  });

  it("rejects text that forms two blocks", () => {
    const result = validateBlockText("Первый абзац.\n\nВторой абзац.", "paragraph");
    assert.ok(!result.ok);
    assert.match(result.error, /2 blocks/);
  });

  it("rejects a list followed by a paragraph", () => {
    const result = validateBlockText("- пункт\n\nАбзац после списка.", "list");
    assert.ok(!result.ok);
    assert.match(result.error, /2 blocks/);
  });

  it("rejects an empty heading that keeps its kind", () => {
    const result = validateBlockText("##", "heading");
    assert.ok(!result.ok);
    assert.match(result.error, /no text/);
  });

  it("rejects a bare list marker that keeps its kind", () => {
    assert.ok(!validateBlockText("-", "list").ok);
  });

  it("rejects a bare quote marker that keeps its kind", () => {
    assert.ok(!validateBlockText(">", "blockquote").ok);
  });

  it("rejects a table skeleton with only empty cells", () => {
    const result = validateBlockText("| | |\n| - | - |", "table");
    assert.ok(!result.ok);
    assert.match(result.error, /no text/);
  });

  it("rejects a code fence with only whitespace inside", () => {
    assert.ok(!validateBlockText("```\n   \n```", "code").ok);
  });

  it("rejects a divider, which the editor never edits", () => {
    const result = validateBlockText("---", "thematicBreak");
    assert.ok(!result.ok);
    assert.match(result.error, /no text/);
  });
});

describe("validateBlockText client bundle", () => {
  // The client checks before the server checks again, so the validator must bundle for the browser (the way
  // `dev` bundles `src/client/main.ts`). A Node-only import anywhere in its graph fails here.
  it("bundles for the browser with no unresolved imports", () => {
    const result = buildSync({
      entryPoints: [`${import.meta.dirname}/validate-block-text.ts`],
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      logLevel: "silent",
    });
    assert.equal(result.warnings.length, 0);
    assert.ok(result.outputFiles[0].text.includes("validateBlockText"));
  });
});
