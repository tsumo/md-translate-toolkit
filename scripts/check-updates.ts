/**
 * Diffs a claimed document (or every one) against upstream: fetches the
 * current HEAD (or --commit's SHA) and diffs it against the manifest's
 * current blocks. Read-only by default. --write applies the diff for
 * real: rewrites the translation file to stay positionally aligned with
 * the new block list, and updates the manifest to match (ADR-012, resync
 * is destructive by design).
 *
 * `npm run check-updates` runs this read-only. `npm run resync` runs it
 * with --write.
 *
 * Usage: tsx tools/scripts/check-updates.ts [<path>] [--commit <sha>] [--write]
 *   No <path>: every claimed document. In a terminal, omitting <path>
 *   opens a document picker instead — offering "All documents" only when
 *   neither --write nor --commit is given, since both need one document.
 *   --commit <sha>: diff against this commit instead of upstream HEAD.
 *     Requires <path> — one commit doesn't mean anything applied across
 *     many different files.
 *   --write: apply the diff instead of only reporting it. Requires
 *     <path> — one command can't yet resync every document at once.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { applyResync } from "../apply-diff.js";
import { NotFoundError } from "../cache.js";
import { diffAgainstUpstream, formatDiffReport } from "../diff-upstream.js";
import { readManifestEntry, writeManifestEntry } from "../manifest-io.js";
import { globManifestPaths, manifestPathFor } from "../paths.js";
import { canPrompt, pickClaimedPath } from "../pick-path.js";
import { parseBlocks, stringifyBlocks } from "../split-blocks.js";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { commit: { type: "string" }, write: { type: "boolean" } },
});

async function resolvePath(): Promise<string | undefined> {
  if (positionals[0]) return positionals[0];
  if (!canPrompt()) return undefined;
  // --write and --commit both need one real document, never "all documents".
  const needsOneDoc = values.write || values.commit !== undefined;
  return needsOneDoc ? pickClaimedPath({ includeAll: false }) : pickClaimedPath({ includeAll: true });
}

async function main(): Promise<void> {
  const path = await resolvePath();

  if (values.write && !path) {
    console.error("Usage: tsx tools/scripts/check-updates.ts <path> --write [--commit <sha>]");
    console.error("--write requires <path> — one command can't resync every document at once.");
    process.exit(1);
  }
  if (values.commit !== undefined && !path) {
    console.error("Usage: tsx tools/scripts/check-updates.ts <path> --commit <sha> [--write]");
    console.error("--commit requires <path> — one commit doesn't apply across many different files.");
    process.exit(1);
  }

  const manifestPaths = path ? [manifestPathFor(path)] : await globManifestPaths();

  if (manifestPaths.length === 0) {
    console.log("No manifest files found yet — nothing to check.");
    return;
  }

  let hasNotFound = false;
  for (const manifestPath of manifestPaths) {
    const entry = readManifestEntry(manifestPath);
    try {
      const { commit, content, newNodes, diff } = await diffAgainstUpstream(entry, values.commit);
      console.log(formatDiffReport(entry, commit, diff));

      if (values.write && commit !== entry.source_commit) {
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
        console.log(`Applied: ${manifestPath} and ${entry.translation_path} updated.`);
      }
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      hasNotFound = true;
      console.error(
        `${entry.original_path}: not found at upstream HEAD — possibly renamed, deleted, or split. Resolve manually.`,
      );
    }
  }

  process.exit(hasNotFound ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
