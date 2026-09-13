import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLACEHOLDER_MARKER, parseBlocks } from "./split-blocks.js";
import { deriveFileStatus, isInvalidCompletion, isValidBlockStatus, VALID_BLOCK_STATUSES } from "./status.js";
import type { BlockEntry } from "./types.js";

function entry(status: BlockEntry["status"]): BlockEntry {
  return { kind: "paragraph", fingerprint: "0000000000000000", status };
}

describe("isValidBlockStatus", () => {
  it("is true for each of the four known statuses", () => {
    for (const status of VALID_BLOCK_STATUSES) {
      assert.equal(isValidBlockStatus(status), true);
    }
  });

  it("is false for a string that isn't a known status", () => {
    assert.equal(isValidBlockStatus("done"), false);
    assert.equal(isValidBlockStatus(""), false);
  });
});

describe("isInvalidCompletion", () => {
  const [untranslated] = parseBlocks(`_${PLACEHOLDER_MARKER}_ preview`);
  const [translated] = parseBlocks("Переведённый текст.");

  it("is true for complete or verified while the block is still untranslated", () => {
    assert.equal(isInvalidCompletion("complete", untranslated), true);
    assert.equal(isInvalidCompletion("verified", untranslated), true);
  });

  it("is false for complete or verified once the block is actually translated", () => {
    assert.equal(isInvalidCompletion("complete", translated), false);
    assert.equal(isInvalidCompletion("verified", translated), false);
  });

  it("is false for in-progress or needs-attention regardless of translation state", () => {
    assert.equal(isInvalidCompletion("in-progress", untranslated), false);
    assert.equal(isInvalidCompletion("needs-attention", untranslated), false);
    assert.equal(isInvalidCompletion("in-progress", translated), false);
    assert.equal(isInvalidCompletion("needs-attention", translated), false);
  });
});

describe("deriveFileStatus", () => {
  it("reports needs-attention if any block does, even if every other block is verified", () => {
    const blocks = [entry("verified"), entry("verified"), entry("needs-attention")];
    const status = deriveFileStatus(blocks, { translated: 3, total: 3 });
    assert.equal(status, "needs-attention");
  });

  it("reports verified when every block is verified", () => {
    const blocks = [entry("verified"), entry("verified")];
    assert.equal(deriveFileStatus(blocks, { translated: 2, total: 2 }), "verified");
  });

  it("reports complete for a mix of complete and verified blocks, with none needing attention", () => {
    const blocks = [entry("complete"), entry("verified")];
    assert.equal(deriveFileStatus(blocks, { translated: 2, total: 2 }), "complete");
  });

  it("reports not-started when no block has any real content yet", () => {
    const blocks = [entry("in-progress"), entry("in-progress")];
    assert.equal(deriveFileStatus(blocks, { translated: 0, total: 2 }), "not-started");
  });

  it("reports in-progress once some content exists, even if every block's stored status is still in-progress", () => {
    // Compare this test to the one above. Both blocks hold the status
    // "in-progress" in both tests. A translator can draft real text into
    // a block, then not yet run set-status. progress.translated shows
    // this happened. The function reads that value, not the stored
    // status. This tells the case apart from an untouched file.
    const blocks = [entry("in-progress"), entry("in-progress")];
    assert.equal(deriveFileStatus(blocks, { translated: 1, total: 2 }), "in-progress");
  });

  it("reports in-progress for a mix of complete and still-pending blocks", () => {
    const blocks = [entry("complete"), entry("in-progress")];
    assert.equal(deriveFileStatus(blocks, { translated: 1, total: 2 }), "in-progress");
  });

  it("reports verified for an empty block list, since every/some are vacuously true/false", () => {
    // Zero-block document falls into the "every block is verified" branch before reaching the not-started check
    assert.equal(deriveFileStatus([], { translated: 0, total: 0 }), "verified");
  });
});
