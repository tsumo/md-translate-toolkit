/**
 * Verifies manifest entries against their pinned original and translation
 * file: sha256/fingerprint integrity, translation block-kind alignment,
 * and the complete/verified completeness gate. Hard failure on any
 * mismatch, no auto-fix (ADR-014, ADR-015).
 *
 * Usage: tsx tools/verify.ts [<path>]
 *   <path>: verify just this manifest entry (original_path). Omit to
 *   verify every entry under manifest/.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fetchOriginal } from "./cache.js";
import { readManifestEntry } from "./manifest-io.js";
import { globManifestPaths, manifestPathFor, PROJECT_ROOT } from "./paths.js";
import { parseBlocks, splitBlocks } from "./split-blocks.js";
import { isInvalidCompletion } from "./status.js";
import type { ManifestEntry } from "./types.js";

async function verifyEntry(entry: ManifestEntry): Promise<string[]> {
  const errors: string[] = [];

  const original = await fetchOriginal(entry.source_repo, entry.source_commit, entry.original_path);
  const sha256 = createHash("sha256").update(original).digest("hex");
  if (sha256 !== entry.source_sha256) {
    errors.push(`sha256 mismatch: pinned ${entry.source_commit} content no longer matches source_sha256`);
  }

  const originalBlocks = splitBlocks(original);
  if (originalBlocks.length !== entry.blocks.length) {
    errors.push(`block count mismatch: original has ${originalBlocks.length}, manifest has ${entry.blocks.length}`);
  } else {
    for (let i = 0; i < originalBlocks.length; i++) {
      const fresh = originalBlocks[i];
      const stored = entry.blocks[i];
      if (fresh.kind !== stored.kind) {
        errors.push(`block ${i}: kind mismatch (original "${fresh.kind}" vs manifest "${stored.kind}")`);
      } else if (fresh.fingerprint !== stored.fingerprint) {
        errors.push(`block ${i}: fingerprint mismatch — original content no longer matches what was pinned`);
      }
    }
  }

  const translationNodes = parseBlocks(readFileSync(entry.translation_path, "utf-8"));
  if (translationNodes.length !== entry.blocks.length) {
    errors.push(
      `translation block count mismatch: translation has ${translationNodes.length}, manifest has ${entry.blocks.length}`,
    );
  } else {
    for (let i = 0; i < entry.blocks.length; i++) {
      if (translationNodes[i].type !== entry.blocks[i].kind) {
        errors.push(
          `translation block ${i}: kind "${translationNodes[i].type}" doesn't match original's "${entry.blocks[i].kind}"`,
        );
      }
      const status = entry.blocks[i].status;
      if (isInvalidCompletion(status, translationNodes[i])) {
        errors.push(`block ${i}: status "${status}" but still holds the untranslated placeholder`);
      }
    }
  }

  return errors;
}

async function main() {
  const path = process.argv[2];
  const manifestPaths = path ? [manifestPathFor(path)] : await globManifestPaths();

  if (manifestPaths.length === 0) {
    console.log("No manifest files found yet — nothing to verify.");
    return;
  }

  let hasErrors = false;
  for (const manifestPath of manifestPaths) {
    const displayPath = relative(PROJECT_ROOT, manifestPath);
    const entry = readManifestEntry(manifestPath);
    const errors = await verifyEntry(entry);
    if (errors.length === 0) {
      console.log(`ok    ${displayPath}`);
    } else {
      hasErrors = true;
      console.error(`FAIL  ${displayPath}`);
      for (const err of errors) console.error(`      ${err}`);
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
