import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyBlockStatus, deriveFileStatus, isValidBlockStatus, VALID_BLOCK_STATUSES } from "./status.js";
import type { BlockEntry, ManifestEntry } from "./types.js";

function entry(status: BlockEntry["status"], kind: BlockEntry["kind"] = "paragraph"): BlockEntry {
  return { kind, fingerprint: "0000000000000000", status };
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
  it("is true for each of the five known statuses", () => {
    for (const status of VALID_BLOCK_STATUSES) {
      assert.equal(isValidBlockStatus(status), true);
    }
  });

  it("is false for a string that isn't a known status", () => {
    assert.equal(isValidBlockStatus("done"), false);
    assert.equal(isValidBlockStatus(""), false);
  });
});

describe("deriveFileStatus", () => {
  it("reports needs-attention if any block does, even if every other block is verified", () => {
    const blocks = [entry("verified"), entry("verified"), entry("needs-attention")];
    assert.equal(deriveFileStatus(blocks), "needs-attention");
  });

  it("reports verified when every block is verified", () => {
    assert.equal(deriveFileStatus([entry("verified"), entry("verified")]), "verified");
  });

  it("reports complete for a mix of complete and verified blocks, with none needing attention", () => {
    assert.equal(deriveFileStatus([entry("complete"), entry("verified")]), "complete");
  });

  it("reports not-started while every block is untranslated", () => {
    assert.equal(deriveFileStatus([entry("untranslated"), entry("untranslated")]), "not-started");
  });

  it("reports not-started for a fresh document whose only verified blocks are structural ones", () => {
    // Dividers and markup-only html blocks are born verified by the toolkit (ADR-017).
    // Their status is not a person's claim, so it cannot start a document.
    const blocks = [entry("untranslated"), entry("verified", "thematicBreak"), entry("verified", "html")];
    assert.equal(deriveFileStatus(blocks), "not-started");
  });

  it("reports in-progress once a person has claimed any block", () => {
    const blocks = [entry("untranslated"), entry("complete"), entry("verified", "thematicBreak")];
    assert.equal(deriveFileStatus(blocks), "in-progress");
  });

  it("reports in-progress for a mix of complete and still-untranslated blocks", () => {
    assert.equal(deriveFileStatus([entry("complete"), entry("untranslated")]), "in-progress");
  });

  it("reports verified for an empty block list, since every/some are vacuously true/false", () => {
    // A document with no blocks reaches the "every block is verified" rule before the not-started rule.
    assert.equal(deriveFileStatus([]), "verified");
  });
});

describe("applyBlockStatus", () => {
  it("mutates the target block, leaves others untouched, and returns the derived file status", () => {
    const manifest = manifestEntry([entry("untranslated"), entry("untranslated")]);
    const result = applyBlockStatus(manifest, [0], "complete", undefined);
    assert.deepEqual(result, { ok: true, fileStatus: "in-progress" });
    assert.equal(manifest.blocks[0].status, "complete");
    assert.equal(manifest.blocks[1].status, "untranslated");
  });

  it("sets the start state back on a translated block when asked", () => {
    const manifest = manifestEntry([entry("complete")]);
    const result = applyBlockStatus(manifest, [0], "untranslated", undefined);
    assert.deepEqual(result, { ok: true, fileStatus: "not-started" });
    assert.equal(manifest.blocks[0].status, "untranslated");
  });

  it("mutates every index in a multi-index call, matching the CLI's no-`--block` bulk case", () => {
    const manifest = manifestEntry([entry("untranslated"), entry("untranslated")]);
    const result = applyBlockStatus(manifest, [0, 1], "verified", undefined);
    assert.deepEqual(result, { ok: true, fileStatus: "verified" });
    assert.equal(manifest.blocks[0].status, "verified");
    assert.equal(manifest.blocks[1].status, "verified");
  });

  it("accepts any status on a block that still holds a placeholder, which the status alone carries", () => {
    const manifest = manifestEntry([entry("untranslated")]);
    const result = applyBlockStatus(manifest, [0], "complete", undefined);
    assert.deepEqual(result, { ok: true, fileStatus: "complete" });
  });

  it("rejects an out-of-range index, leaving every block unmutated", () => {
    const manifest = manifestEntry([entry("untranslated")]);
    const result = applyBlockStatus(manifest, [5], "complete", undefined);
    assert.equal(result.ok, false);
    assert.equal(manifest.blocks[0].status, "untranslated");
  });

  it("rejects needs-attention with no comment, and accepts it once one is given", () => {
    const manifest = manifestEntry([entry("untranslated")]);
    const withoutComment = applyBlockStatus(manifest, [0], "needs-attention", undefined);
    assert.equal(withoutComment.ok, false);
    assert.equal(manifest.blocks[0].status, "untranslated");

    const withComment = applyBlockStatus(manifest, [0], "needs-attention", "check this");
    assert.equal(withComment.ok, true);
    assert.equal(manifest.blocks[0].status, "needs-attention");
    assert.equal(manifest.blocks[0].status_comment, "check this");
  });

  it("clears a block's prior status_comment when re-set with no new comment", () => {
    const manifest = manifestEntry([
      { kind: "paragraph", fingerprint: "0000000000000000", status: "needs-attention", status_comment: "old note" },
    ]);
    const result = applyBlockStatus(manifest, [0], "complete", undefined);
    assert.equal(result.ok, true);
    assert.equal(manifest.blocks[0].status, "complete");
    assert.equal(manifest.blocks[0].status_comment, undefined);
  });

  it("never stores an empty-string comment, from either the command or the dev server", () => {
    const manifest = manifestEntry([{ kind: "paragraph", fingerprint: "0000000000000000", status: "complete" }]);
    const result = applyBlockStatus(manifest, [0], "in-progress", "");
    assert.equal(result.ok, true);
    assert.equal(manifest.blocks[0].status_comment, undefined);
  });

  it("treats an empty-string comment as absent for the needs-attention requirement", () => {
    const manifest = manifestEntry([{ kind: "paragraph", fingerprint: "0000000000000000", status: "complete" }]);
    const result = applyBlockStatus(manifest, [0], "needs-attention", "");
    assert.equal(result.ok, false);
    assert.equal(manifest.blocks[0].status, "complete");
  });

  it("stores a comment trimmed of surrounding whitespace", () => {
    const manifest = manifestEntry([{ kind: "paragraph", fingerprint: "0000000000000000", status: "complete" }]);
    const result = applyBlockStatus(manifest, [0], "in-progress", "  check this  ");
    assert.equal(result.ok, true);
    assert.equal(manifest.blocks[0].status_comment, "check this");
  });

  it("treats a whitespace-only comment as absent, for storage and for the needs-attention requirement", () => {
    const manifest = manifestEntry([{ kind: "paragraph", fingerprint: "0000000000000000", status: "complete" }]);
    const stored = applyBlockStatus(manifest, [0], "in-progress", "   ");
    assert.equal(stored.ok, true);
    assert.equal(manifest.blocks[0].status_comment, undefined);

    const refused = applyBlockStatus(manifest, [0], "needs-attention", "   ");
    assert.equal(refused.ok, false);
  });
});
