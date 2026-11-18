import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSafeOriginalPath } from "./paths.js";

describe("isSafeOriginalPath", () => {
  it("accepts a document path that resolves inside the manifest folder", () => {
    assert.equal(isSafeOriginalPath("Example.md", "manifest"), true);
    assert.equal(isSafeOriginalPath("reviewed/Example.md", "manifest"), true);
  });

  it("refuses a parent traversal out of the manifest folder", () => {
    assert.equal(isSafeOriginalPath("../Example.md", "manifest"), false);
    assert.equal(isSafeOriginalPath("reviewed/../../secrets.md", "manifest"), false);
  });

  it("refuses an absolute path", () => {
    assert.equal(isSafeOriginalPath("/etc/secrets.md", "manifest"), false);
  });

  it("accepts a name that starts with dots but holds no .. segment", () => {
    // The containment check splits on separators, so `..foo.md` is one legal segment, not traversal.
    assert.equal(isSafeOriginalPath("..foo.md", "manifest"), true);
  });
});
