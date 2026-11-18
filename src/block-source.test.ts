import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rawBlockSource, replaceBlockSource } from "./block-source.js";
import { parseBlocks } from "./parse-blocks.js";

describe("rawBlockSource", () => {
  it("returns the exact raw text of a middle block, without the blank lines around it", () => {
    const markdown = "Первый абзац.\n\nВторой абзац.\n\nТретий абзац.\n";
    assert.equal(rawBlockSource(markdown, 1), "Второй абзац.");
  });

  it("returns the first block", () => {
    const markdown = "# Заголовок\n\nАбзац.\n";
    assert.equal(rawBlockSource(markdown, 0), "# Заголовок");
  });

  it("returns the last block without its trailing newline", () => {
    const markdown = "Абзац.\n\nВторой абзац.\n";
    assert.equal(rawBlockSource(markdown, 1), "Второй абзац.");
  });

  it("returns a code block with its fences and language", () => {
    const markdown = "Введение.\n\n```js\nкод();\n```\n";
    assert.equal(rawBlockSource(markdown, 1), "```js\nкод();\n```");
  });

  it("returns a whole list with every item", () => {
    const markdown = "До списка.\n\n- один\n- два\n- три\n\nПосле списка.";
    assert.equal(rawBlockSource(markdown, 1), "- один\n- два\n- три");
  });

  it("throws for an index without a block", () => {
    assert.throws(() => rawBlockSource("Один абзац.", 5), /index 5/);
  });
});

describe("replaceBlockSource", () => {
  it("replaces one middle block in place, keeping the blank lines around it", () => {
    const markdown = "Первый абзац.\n\nВторой абзац.\n\nТретий абзац.\n";
    const result = replaceBlockSource(markdown, 1, "Новый второй абзац.");
    assert.equal(result, "Первый абзац.\n\nНовый второй абзац.\n\nТретий абзац.\n");
  });

  it("changes no other block's raw source", () => {
    const markdown = "# Заголовок\n\nСтарый абзац.\n\n- один\n- два\n\n```js\nкод();\n```\n\n> Цитата.\n\n---\n";
    const result = replaceBlockSource(markdown, 2, "- первый\n- второй\n- третий");
    const before = parseBlocks(markdown);
    const after = parseBlocks(result);
    assert.equal(after.length, before.length);
    after.forEach((node, i) => {
      assert.equal(node.type, before[i].type, `kind changed at block ${i}`);
      if (i !== 2) assert.equal(rawBlockSource(result, i), rawBlockSource(markdown, i), `block ${i} changed`);
    });
    assert.equal(rawBlockSource(result, 2), "- первый\n- второй\n- третий");
  });

  it("re-parses to the same block count and kinds", () => {
    const markdown = "# Заголовок\n\nАбзац.\n\n> Цитата.\n\n```js\nкод();\n```\n";
    const result = replaceBlockSource(markdown, 2, "> Новая цитата.");
    const before = parseBlocks(markdown).map((node) => node.type);
    const after = parseBlocks(result).map((node) => node.type);
    assert.deepEqual(after, before);
    assert.equal(after.length, 4);
  });

  it("keeps a document without a trailing newline without one", () => {
    const markdown = "Абзац.\n\nВторой абзац.";
    const result = replaceBlockSource(markdown, 1, "Новый конец.");
    assert.equal(result, "Абзац.\n\nНовый конец.");
  });

  it("replaces a multi-line list with another multi-line list", () => {
    const markdown = "Вступление.\n\n1. один\n2. два\n3. три\n\nЗаключение.\n";
    const result = replaceBlockSource(markdown, 1, "1. первый\n2. второй");
    assert.equal(result, "Вступление.\n\n1. первый\n2. второй\n\nЗаключение.\n");
  });

  it("round-trips a document when every block is replaced in turn", () => {
    const markdown = "# Заголовок\n\nАбзац.\n\n> Цитата.\n";
    const replacements = ["# Новый заголовок", "Новый абзац.", "> Новая цитата."];
    let current = markdown;
    replacements.forEach((text, i) => {
      current = replaceBlockSource(current, i, text);
    });
    assert.equal(current, "# Новый заголовок\n\nНовый абзац.\n\n> Новая цитата.\n");
  });

  it("throws for an index without a block", () => {
    assert.throws(() => replaceBlockSource("Один абзац.", 3, "text"), /index 3/);
  });
});
