import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLACEHOLDER_MARKER, parseBlocks } from "./split-blocks.js";
import {
  applyBlockStatus,
  deriveFileStatus,
  isInvalidCompletion,
  isValidBlockStatus,
  VALID_BLOCK_STATUSES,
} from "./status.js";
import type { BlockEntry, ManifestEntry } from "./types.js";

function entry(status: BlockEntry["status"]): BlockEntry {
  return { kind: "paragraph", fingerprint: "0000000000000000", status };
}

function manifestEntry(blocks: BlockEntry[]): ManifestEntry {
  return {
    original_path: "reviewed/Simple.md",
    source_repo: "user/Source-Repo",
    source_commit: "abc123",
    source_sha256: "deadbeef",
    translation_path: "translations/reviewed/Simple.md",
    last_synced: "2026-01-01",
    blocks,
  };
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
    // Compare this test with the one above. Both use the status "in-progress".
    // A translator can draft real text and not yet run `set-status`.
    // `progress.translated` shows this. The function reads that value, not the stored status.
    // This tells the case apart from an untouched file.
    const blocks = [entry("in-progress"), entry("in-progress")];
    assert.equal(deriveFileStatus(blocks, { translated: 1, total: 2 }), "in-progress");
  });

  it("reports in-progress for a mix of complete and still-pending blocks", () => {
    const blocks = [entry("complete"), entry("in-progress")];
    assert.equal(deriveFileStatus(blocks, { translated: 1, total: 2 }), "in-progress");
  });

  it("reports verified for an empty block list, since every/some are vacuously true/false", () => {
    // A document with no blocks reaches the "every block is verified" rule before the not-started rule.
    assert.equal(deriveFileStatus([], { translated: 0, total: 0 }), "verified");
  });
});

describe("applyBlockStatus", () => {
  const translatedTwoBlocks = "Переведён первый блок.\n\nПереведён второй блок.";

  it("mutates the target block, leaves others untouched, and returns the derived file status", () => {
    const manifest = manifestEntry([entry("in-progress"), entry("in-progress")]);
    const result = applyBlockStatus(manifest, translatedTwoBlocks, [0], "complete", undefined);
    assert.deepEqual(result, { ok: true, fileStatus: "in-progress" });
    assert.equal(manifest.blocks[0].status, "complete");
    assert.equal(manifest.blocks[1].status, "in-progress");
  });

  it("mutates every index in a multi-index call, matching the CLI's no-`--block` bulk case", () => {
    const manifest = manifestEntry([entry("in-progress"), entry("in-progress")]);
    const result = applyBlockStatus(manifest, translatedTwoBlocks, [0, 1], "verified", undefined);
    assert.deepEqual(result, { ok: true, fileStatus: "verified" });
    assert.equal(manifest.blocks[0].status, "verified");
    assert.equal(manifest.blocks[1].status, "verified");
  });

  it("rejects an out-of-range index, leaving every block unmutated", () => {
    const manifest = manifestEntry([entry("in-progress")]);
    const result = applyBlockStatus(manifest, translatedTwoBlocks, [5], "complete", undefined);
    assert.equal(result.ok, false);
    assert.equal(manifest.blocks[0].status, "in-progress");
  });

  it("rejects complete/verified against a still-placeholder translation block", () => {
    const manifest = manifestEntry([entry("in-progress")]);
    const stillPlaceholder = `_${PLACEHOLDER_MARKER}_ preview text.`;
    const result = applyBlockStatus(manifest, stillPlaceholder, [0], "complete", undefined);
    assert.equal(result.ok, false);
    assert.equal(manifest.blocks[0].status, "in-progress");
  });

  it("rejects needs-attention with no comment, and accepts it once one is given", () => {
    const manifest = manifestEntry([entry("in-progress")]);
    const withoutComment = applyBlockStatus(manifest, translatedTwoBlocks, [0], "needs-attention", undefined);
    assert.equal(withoutComment.ok, false);
    assert.equal(manifest.blocks[0].status, "in-progress");

    const withComment = applyBlockStatus(manifest, translatedTwoBlocks, [0], "needs-attention", "check this");
    assert.equal(withComment.ok, true);
    assert.equal(manifest.blocks[0].status, "needs-attention");
    assert.equal(manifest.blocks[0].status_comment, "check this");
  });

  it("clears a block's prior status_comment when re-set with no new comment", () => {
    const manifest = manifestEntry([
      { kind: "paragraph", fingerprint: "0000000000000000", status: "needs-attention", status_comment: "old note" },
    ]);
    const result = applyBlockStatus(manifest, translatedTwoBlocks, [0], "complete", undefined);
    assert.equal(result.ok, true);
    assert.equal(manifest.blocks[0].status, "complete");
    assert.equal(manifest.blocks[0].status_comment, undefined);
  });
});
