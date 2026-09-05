/**
 * Applies an upstream diff: rewrites the translation file to stay
 * positionally aligned with the new block list, and updates the manifest
 * to match.
 *
 * Usage: tsx tools/scripts/resync.ts [<path>] [--commit <sha>]
 *   In a terminal, omitting <path> opens a document picker instead.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { applyResync } from "../apply-diff.js";
import { NotFoundError } from "../cache.js";
import { diffAgainstUpstream, formatDiffReport } from "../diff-upstream.js";
import { readManifestEntry, writeManifestEntry } from "../manifest-io.js";
import { manifestPathFor } from "../paths.js";
import { canPrompt, pickClaimedPath } from "../pick-path.js";
import { parseBlocks, stringifyBlocks } from "../split-blocks.js";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { commit: { type: "string" } },
});

async function main(): Promise<void> {
  const path = positionals[0] ?? (canPrompt() ? await pickClaimedPath({ includeAll: false }) : undefined);
  if (!path) {
    console.error("Usage: tsx tools/scripts/resync.ts <path> [--commit <sha>]");
    process.exit(1);
  }

  const manifestPath = manifestPathFor(path);
  const entry = readManifestEntry(manifestPath);
  const { commit, content, newNodes, diff } = await diffAgainstUpstream(entry, values.commit);

  if (commit === entry.source_commit) {
    console.log(formatDiffReport(entry, commit, diff));
    return;
  }

  const oldTranslationNodes = parseBlocks(readFileSync(entry.translation_path, "utf-8"));
  const today = new Date().toISOString().slice(0, 10);
  const { translationNodes, blocks } = applyResync(diff, entry.blocks, oldTranslationNodes, newNodes, today);

  writeFileSync(entry.translation_path, stringifyBlocks(translationNodes));
  writeManifestEntry(manifestPath, {
    ...entry,
    source_commit: commit,
    source_sha256: createHash("sha256").update(content).digest("hex"),
    last_synced: today,
    blocks,
  });

  console.log(formatDiffReport(entry, commit, diff));
  console.log(`Applied: ${manifestPath} and ${entry.translation_path} updated.`);
}

main().catch((err) => {
  if (err instanceof NotFoundError) {
    console.error(`${err.message} — possibly renamed, deleted, or split upstream. Resolve manually.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
