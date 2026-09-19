/**
 * Checks manifest entries against their pinned original and translation
 * file: sha256/fingerprint integrity, translation block-kind alignment,
 * and the complete/verified completeness gate. Also cross-checks the
 * manifest/ and translations/ trees against each other (ADR-009, ADR-010).
 * No CLI of its own — `build.ts` calls `verifyAll`.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { RootContent } from "mdast";
import { fetchOriginal } from "./cache.js";
import { readManifestEntry } from "./manifest-io.js";
import { globTranslationPaths } from "./paths.js";
import { fingerprintBlock, parseBlocks } from "./split-blocks.js";
import { isInvalidCompletion } from "./status.js";
import type { ManifestEntry } from "./types.js";

export interface CheckResult {
  errors: string[];
  originalNodes: RootContent[];
  translationNodes?: RootContent[];
}

/**
 * Checks `entry` against already-loaded original and translation content.
 */
export function checkEntry(
  entry: ManifestEntry,
  originalContent: string,
  translationContent: string | undefined,
): CheckResult {
  const errors: string[] = [];

  const sha256 = createHash("sha256").update(originalContent).digest("hex");
  if (sha256 !== entry.source_sha256) {
    errors.push(`sha256 mismatch: pinned ${entry.source_commit} content no longer matches source_sha256`);
  }

  const originalNodes = parseBlocks(originalContent);
  if (originalNodes.length !== entry.blocks.length) {
    errors.push(`block count mismatch: original has ${originalNodes.length}, manifest has ${entry.blocks.length}`);
  } else {
    for (let i = 0; i < originalNodes.length; i++) {
      const fresh = originalNodes[i];
      const stored = entry.blocks[i];
      if (fresh.type !== stored.kind) {
        errors.push(`block ${i}: kind mismatch (original "${fresh.type}" vs manifest "${stored.kind}")`);
      } else if (fingerprintBlock(fresh) !== stored.fingerprint) {
        errors.push(`block ${i}: fingerprint mismatch — original content no longer matches what was pinned`);
      }
    }
  }

  if (translationContent === undefined) {
    errors.push(`translation_path "${entry.translation_path}" does not exist`);
    return { errors, originalNodes };
  }

  const translationNodes = parseBlocks(translationContent);
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

  return { errors, originalNodes, translationNodes };
}

/** Every translation file with no manifest entry claiming it. */
export async function findOrphanedTranslations(
  entries: ManifestEntry[],
  root: string,
  translationsDir: string,
): Promise<string[]> {
  const claimedPaths = new Set(entries.map((entry) => join(root, entry.translation_path)));
  const translationFiles = await globTranslationPaths(root, translationsDir);
  return translationFiles.filter((file) => !claimedPaths.has(file)).map((file) => relative(root, file));
}

export interface VerifyAllResult {
  entries: ManifestEntry[];
  results: CheckResult[];
  hasErrors: boolean;
}

/**
 * Loads and checks every manifest at `manifestPaths`, printing an
 * `ok`/`FAIL` line for each as it goes.
 */
export async function verifyAll(
  manifestPaths: string[],
  checkOrphans: boolean,
  root: string,
  translationsDir: string,
  cacheDir: string,
): Promise<VerifyAllResult> {
  let hasErrors = false;
  const entries: ManifestEntry[] = [];
  const results: CheckResult[] = [];

  for (const manifestPath of manifestPaths) {
    const displayPath = relative(root, manifestPath);
    const entry = readManifestEntry(manifestPath);
    entries.push(entry);

    const originalContent = await fetchOriginal(entry.source_repo, entry.source_commit, entry.original_path, cacheDir);
    const translationContent = existsSync(entry.translation_path)
      ? readFileSync(entry.translation_path, "utf-8")
      : undefined;
    const result = checkEntry(entry, originalContent, translationContent);
    results.push(result);

    if (result.errors.length === 0) {
      console.log(`ok    ${displayPath}`);
    } else {
      hasErrors = true;
      console.error(`FAIL  ${displayPath}`);
      for (const err of result.errors) console.error(`      ${err}`);
    }
  }

  // A single-document check has only that one path in `entries`. Every
  // other real, claimed file would show as an orphan. This check needs
  // every entry loaded to work correctly.
  if (checkOrphans) {
    for (const orphan of await findOrphanedTranslations(entries, root, translationsDir)) {
      hasErrors = true;
      console.error(`FAIL  ${orphan}: no manifest entry claims this translation file`);
    }
  }

  return { entries, results, hasErrors };
}
