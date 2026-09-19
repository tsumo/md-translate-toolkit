import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyResync, resolveStatus } from "./apply-diff.js";
import type { DiffEntry } from "./diff-upstream.js";
import { parseBlocks } from "./split-blocks.js";
import type { BlockEntry } from "./types.js";

const TODAY = "2026-09-02";

function block(status: BlockEntry["status"], comment?: string): BlockEntry {
  return { kind: "paragraph", fingerprint: "0000000000000000", status, status_comment: comment };
}

describe("resolveStatus", () => {
  it("carries an unchanged block's status and comment forward untouched", () => {
    const diffEntry: DiffEntry = { kind: "unchanged", oldIndex: 0, newIndex: 0 };
    const oldBlocks = [block("needs-attention", "existing note")];
    assert.deepEqual(resolveStatus(diffEntry, oldBlocks, TODAY), {
      status: "needs-attention",
      status_comment: "existing note",
    });
  });

  it("downgrades a changed block from complete to needs-attention with an auto comment", () => {
    const diffEntry: DiffEntry = { kind: "changed", oldIndex: 0, newIndex: 0 };
    const oldBlocks = [block("complete")];
    assert.deepEqual(resolveStatus(diffEntry, oldBlocks, TODAY), {
      status: "needs-attention",
      status_comment: "Upstream content changed on 2026-09-02 — re-check against source.",
    });
  });

  it("downgrades a changed block from verified to needs-attention with an auto comment", () => {
    const diffEntry: DiffEntry = { kind: "changed", oldIndex: 0, newIndex: 0 };
    const oldBlocks = [block("verified")];
    assert.deepEqual(resolveStatus(diffEntry, oldBlocks, TODAY), {
      status: "needs-attention",
      status_comment: "Upstream content changed on 2026-09-02 — re-check against source.",
    });
  });

  it("leaves a changed block already needs-attention as-is, keeping its own comment", () => {
    const diffEntry: DiffEntry = { kind: "changed", oldIndex: 0, newIndex: 0 };
    const oldBlocks = [block("needs-attention", "pre-existing human comment")];
    assert.deepEqual(resolveStatus(diffEntry, oldBlocks, TODAY), {
      status: "needs-attention",
      status_comment: "pre-existing human comment",
    });
  });

  it("leaves a changed block already in-progress as-is", () => {
    const diffEntry: DiffEntry = { kind: "changed", oldIndex: 0, newIndex: 0 };
    const oldBlocks = [block("in-progress")];
    assert.deepEqual(resolveStatus(diffEntry, oldBlocks, TODAY), { status: "in-progress", status_comment: undefined });
  });

  it("gives an added block the in-progress default, with no prior block to inherit from", () => {
    const diffEntry: DiffEntry = { kind: "added", newIndex: 0 };
    assert.deepEqual(resolveStatus(diffEntry, [], TODAY), { status: "in-progress" });
  });
});

describe("applyResync", () => {
  it("carries an unchanged block's translation forward at a shifted index", () => {
    const [oldNode] = parseBlocks("Переведено.");
    const [newA] = parseBlocks("A");
    const [newB] = parseBlocks("B");
    const diff: DiffEntry[] = [
      { kind: "added", newIndex: 0 },
      { kind: "unchanged", oldIndex: 0, newIndex: 1 },
    ];
    const { translationNodes, blocks } = applyResync(diff, [block("verified")], [oldNode], [newA, newB], TODAY);

    assert.equal(translationNodes[1], oldNode);
    assert.equal(blocks[1].status, "verified");
    assert.equal(blocks.length, 2);
  });

  it("keeps a changed block's old translation content in place, only downgrading its status", () => {
    const [oldTranslation] = parseBlocks("Старый перевод.");
    const [newNode] = parseBlocks("New upstream text.");
    const diff: DiffEntry[] = [{ kind: "changed", oldIndex: 0, newIndex: 0 }];
    const { translationNodes, blocks } = applyResync(diff, [block("complete")], [oldTranslation], [newNode], TODAY);

    assert.equal(translationNodes[0], oldTranslation);
    assert.equal(blocks[0].status, "needs-attention");
  });

  it("generates a fresh placeholder, from the real new content, for an added block", () => {
    const [newNode] = parseBlocks("Brand new upstream paragraph.");
    const diff: DiffEntry[] = [{ kind: "added", newIndex: 0 }];
    const { translationNodes, blocks } = applyResync(diff, [], [], [newNode], TODAY);

    const text = translationNodes[0];
    assert.equal(text.type, "paragraph");
    assert.equal(blocks[0].status, "in-progress");
  });

  it("drops a removed block's translation entirely, with no gap in the output", () => {
    const [survivor] = parseBlocks("Survives.");
    const [newSurvivor] = parseBlocks("Survives.");
    // The old file had 2 blocks. The new upstream has 1, so one block was removed.
    const diff: DiffEntry[] = [{ kind: "unchanged", oldIndex: 0, newIndex: 0 }];
    const { translationNodes, blocks } = applyResync(
      diff,
      [block("verified"), block("in-progress")],
      [survivor, survivor],
      [newSurvivor],
      TODAY,
    );

    assert.equal(translationNodes.length, 1);
    assert.equal(blocks.length, 1);
  });

  it("orders output blocks to match the new node list, regardless of diff shape", () => {
    const [a] = parseBlocks("# Heading");
    const [b] = parseBlocks("A paragraph.");
    const diff: DiffEntry[] = [
      { kind: "added", newIndex: 0 },
      { kind: "added", newIndex: 1 },
    ];
    const { blocks } = applyResync(diff, [], [], [a, b], TODAY);

    assert.deepEqual(
      blocks.map((b) => b.kind),
      ["heading", "paragraph"],
    );
  });
});
