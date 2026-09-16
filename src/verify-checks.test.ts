import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { fingerprintBlock, PLACEHOLDER_MARKER, parseBlocks, placeholderFor, stringifyBlocks } from "./split-blocks.js";
import type { BlockEntry, ManifestEntry } from "./types.js";
import { checkEntry } from "./verify-checks.js";

const ORIGINAL = "# Heading\n\nA paragraph.\n";

/** A manifest entry whose blocks genuinely match `original`, as add-source.ts would produce. */
function entryFor(original: string, overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  const blocks: BlockEntry[] = parseBlocks(original).map((node) => ({
    kind: node.type,
    fingerprint: fingerprintBlock(node),
    status: "in-progress",
  }));
  return {
    original_path: "reviewed/Test.md",
    source_repo: "user/Source-Repo",
    source_commit: "abc123",
    source_sha256: createHash("sha256").update(original).digest("hex"),
    translation_path: "translations/reviewed/Test.md",
    last_synced: "2026-01-01",
    blocks,
    ...overrides,
  };
}

describe("checkEntry", () => {
  it("reports no errors and returns both sides' parsed nodes for genuinely matching content", () => {
    const entry = entryFor(ORIGINAL);
    const translation = "# Заголовок\n\nАбзац.\n";
    const result = checkEntry(entry, ORIGINAL, translation);

    assert.deepEqual(result.errors, []);
    assert.equal(result.originalNodes.length, 2);
    assert.equal(result.translationNodes?.length, 2);
  });

  it("flags a sha256 mismatch when the pinned hash no longer matches the content", () => {
    const entry = entryFor(ORIGINAL, {
      source_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    });
    const result = checkEntry(entry, ORIGINAL, ORIGINAL);
    assert.ok(result.errors.some((e) => e.includes("sha256 mismatch")));
  });

  it("flags a block count mismatch between the original and the manifest", () => {
    const entry = entryFor(ORIGINAL, { blocks: [] });
    const result = checkEntry(entry, ORIGINAL, ORIGINAL);
    assert.ok(result.errors.some((e) => e.includes("block count mismatch")));
  });

  it("flags a block kind mismatch at a specific index", () => {
    const entry = entryFor(ORIGINAL);
    entry.blocks[0] = { ...entry.blocks[0], kind: "paragraph" };
    const result = checkEntry(entry, ORIGINAL, ORIGINAL);
    assert.ok(result.errors.some((e) => e.includes("block 0: kind mismatch")));
  });

  it("flags a fingerprint mismatch when the original's content has changed since pinning", () => {
    const entry = entryFor(ORIGINAL);
    entry.blocks[1] = { ...entry.blocks[1], fingerprint: "0000000000000000" };
    const result = checkEntry(entry, ORIGINAL, ORIGINAL);
    assert.ok(result.errors.some((e) => e.includes("block 1: fingerprint mismatch")));
  });

  it("flags a missing translation file, and still returns the original's parsed nodes", () => {
    const entry = entryFor(ORIGINAL);
    const result = checkEntry(entry, ORIGINAL, undefined);
    assert.ok(result.errors.some((e) => e.includes('translation_path "translations/reviewed/Test.md" does not exist')));
    assert.equal(result.originalNodes.length, 2);
    assert.equal(result.translationNodes, undefined);
  });

  it("flags a translation block count mismatch", () => {
    const entry = entryFor(ORIGINAL);
    const result = checkEntry(entry, ORIGINAL, "# Заголовок\n");
    assert.ok(result.errors.some((e) => e.includes("translation block count mismatch")));
  });

  it("flags a translation block kind mismatch at a specific index", () => {
    const entry = entryFor(ORIGINAL);
    const result = checkEntry(entry, ORIGINAL, "Абзац.\n\n# Заголовок\n");
    assert.ok(result.errors.some((e) => e.includes('translation block 0: kind "paragraph"')));
  });

  it("flags a block marked complete or verified that still holds the untranslated placeholder", () => {
    const entry = entryFor(ORIGINAL);
    entry.blocks[0] = { ...entry.blocks[0], status: "complete" };
    const [headingNode] = parseBlocks(ORIGINAL);
    const translation = `${stringifyBlocks([placeholderFor(headingNode)])}\nАбзац.\n`;
    const result = checkEntry(entry, ORIGINAL, translation);
    assert.ok(result.errors.some((e) => e.includes('block 0: status "complete" but still holds')));
  });

  it("does not flag an in-progress block that still holds the placeholder", () => {
    const entry = entryFor(ORIGINAL);
    const [headingNode] = parseBlocks(ORIGINAL);
    const translation = `${stringifyBlocks([placeholderFor(headingNode)])}\nАбзац.\n`;
    const result = checkEntry(entry, ORIGINAL, translation);
    assert.deepEqual(result.errors, []);
    // Sanity check that the placeholder text is really there, so the test above proves something.
    assert.ok(stringifyBlocks([placeholderFor(headingNode)]).includes(PLACEHOLDER_MARKER));
  });
});
