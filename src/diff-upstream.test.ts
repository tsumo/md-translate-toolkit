import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffBlocks, removedOldIndices } from "./diff-upstream.js";
import type { ContentBlock } from "./split-blocks.js";

/** A minimal ContentBlock fixture — diffBlocks only reads `fingerprint`. */
function block(fingerprint: string): ContentBlock {
  return { kind: "paragraph", fingerprint };
}

function blocks(...fingerprints: string[]): ContentBlock[] {
  return fingerprints.map(block);
}

describe("diffBlocks / removedOldIndices", () => {
  it("marks every block unchanged at the same index when nothing changed", () => {
    const diff = diffBlocks(blocks("A", "B", "C"), blocks("A", "B", "C"));
    assert.deepEqual(diff, [
      { kind: "unchanged", oldIndex: 0, newIndex: 0 },
      { kind: "unchanged", oldIndex: 1, newIndex: 1 },
      { kind: "unchanged", oldIndex: 2, newIndex: 2 },
    ]);
    assert.deepEqual(removedOldIndices(diff, 3), []);
  });

  it("keeps a block unchanged at a shifted index when something is inserted before it", () => {
    const diff = diffBlocks(blocks("A", "B", "C"), blocks("X", "A", "B", "C"));
    assert.deepEqual(diff, [
      { kind: "added", newIndex: 0 },
      { kind: "unchanged", oldIndex: 0, newIndex: 1 },
      { kind: "unchanged", oldIndex: 1, newIndex: 2 },
      { kind: "unchanged", oldIndex: 2, newIndex: 3 },
    ]);
    assert.deepEqual(removedOldIndices(diff, 3), []);
  });

  it("omits a removed block's entry and shifts the indices that follow it", () => {
    const diff = diffBlocks(blocks("A", "B", "C"), blocks("A", "C"));
    assert.deepEqual(diff, [
      { kind: "unchanged", oldIndex: 0, newIndex: 0 },
      { kind: "unchanged", oldIndex: 2, newIndex: 1 },
    ]);
    assert.deepEqual(removedOldIndices(diff, 3), [1]);
  });

  it("adds an entry for a block inserted mid-sequence", () => {
    const diff = diffBlocks(blocks("A", "C"), blocks("A", "B", "C"));
    assert.deepEqual(diff, [
      { kind: "unchanged", oldIndex: 0, newIndex: 0 },
      { kind: "added", newIndex: 1 },
      { kind: "unchanged", oldIndex: 1, newIndex: 2 },
    ]);
    assert.deepEqual(removedOldIndices(diff, 2), []);
  });

  it("classifies an in-place substitution as changed", () => {
    const diff = diffBlocks(blocks("A", "B", "C"), blocks("A", "B2", "C"));
    assert.deepEqual(diff, [
      { kind: "unchanged", oldIndex: 0, newIndex: 0 },
      { kind: "changed", oldIndex: 1, newIndex: 1 },
      { kind: "unchanged", oldIndex: 2, newIndex: 2 },
    ]);
    assert.deepEqual(removedOldIndices(diff, 3), []);
  });

  it("classifies a 1:2 replacement as one changed pair plus one added block", () => {
    const diff = diffBlocks(blocks("A", "B", "C"), blocks("A", "X", "Y", "C"));
    assert.deepEqual(diff, [
      { kind: "unchanged", oldIndex: 0, newIndex: 0 },
      { kind: "changed", oldIndex: 1, newIndex: 1 },
      { kind: "added", newIndex: 2 },
      { kind: "unchanged", oldIndex: 2, newIndex: 3 },
    ]);
    assert.deepEqual(removedOldIndices(diff, 3), []);
  });

  it("classifies a 2:1 replacement as one changed pair plus one removed block", () => {
    const diff = diffBlocks(blocks("A", "B", "D", "C"), blocks("A", "X", "C"));
    assert.deepEqual(diff, [
      { kind: "unchanged", oldIndex: 0, newIndex: 0 },
      { kind: "changed", oldIndex: 1, newIndex: 1 },
      { kind: "unchanged", oldIndex: 3, newIndex: 2 },
    ]);
    assert.deepEqual(removedOldIndices(diff, 4), [2]);
  });

  it("matches duplicate fingerprints in sequence order, not just by value", () => {
    const diff = diffBlocks(blocks("SEP", "A", "SEP"), blocks("SEP", "B", "SEP"));
    assert.deepEqual(diff, [
      { kind: "unchanged", oldIndex: 0, newIndex: 0 },
      { kind: "changed", oldIndex: 1, newIndex: 1 },
      { kind: "unchanged", oldIndex: 2, newIndex: 2 },
    ]);
    assert.deepEqual(removedOldIndices(diff, 3), []);
  });

  it("reports no entries and every old index as removed when everything is removed", () => {
    const diff = diffBlocks(blocks("A", "B", "C"), []);
    assert.deepEqual(diff, []);
    assert.deepEqual(removedOldIndices(diff, 3), [0, 1, 2]);
  });

  it("classifies every block as added when there were no old blocks", () => {
    const diff = diffBlocks([], blocks("A", "B", "C"));
    assert.deepEqual(diff, [
      { kind: "added", newIndex: 0 },
      { kind: "added", newIndex: 1 },
      { kind: "added", newIndex: 2 },
    ]);
    assert.deepEqual(removedOldIndices(diff, 0), []);
  });
});
