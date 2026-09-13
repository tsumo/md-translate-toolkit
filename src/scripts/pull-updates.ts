/**
 * Diffs a claimed document (or every one) against upstream: fetches the
 * current HEAD (or --commit's SHA) and diffs it against the manifest's
 * current blocks. Read-only by default. --apply applies the diff for
 * real: rewrites the translation file to stay positionally aligned with
 * the new block list, and updates the manifest to match (ADR-010, this
 * is destructive by design).
 *
 * Usage: md-translate pull-updates [<path>] [--commit <sha>] [--apply]
 *   No <path>: every claimed document, for both the report and --apply.
 *     In a terminal, omitting <path> opens a document picker instead,
 *     offering "All documents" unless --commit is also given.
 *   --commit <sha>: diff against this commit instead of upstream HEAD.
 *     Requires <path> — one commit doesn't mean anything applied across
 *     many different files.
 *   --apply: apply the diff instead of only reporting it.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { applyResync } from "../apply-diff.js";
import { NotFoundError } from "../cache.js";
import type { ResolvedConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { diffAgainstUpstream, formatDiffReport } from "../diff-upstream.js";
import { readManifestEntry, writeManifestEntry } from "../manifest-io.js";
import { globManifestPaths, manifestPathFor } from "../paths.js";
import { canPrompt, pickClaimedPath } from "../pick-path.js";
import { parseBlocks, stringifyBlocks } from "../split-blocks.js";

async function resolvePath(
  positionals: string[],
  values: { commit?: string },
  config: ResolvedConfig,
): Promise<string | undefined> {
  if (positionals[0]) return positionals[0];
  if (!canPrompt()) return undefined;
  // --commit needs one real document, never "all documents" — --apply doesn't.
  return values.commit !== undefined
    ? pickClaimedPath({ includeAll: false }, config.root, config.manifestDir)
    : pickClaimedPath({ includeAll: true }, config.root, config.manifestDir);
}

export async function runPullUpdates(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { commit: { type: "string" }, apply: { type: "boolean" }, config: { type: "string" } },
  });

  const config = await loadConfig(values.config);
  const path = await resolvePath(positionals, values, config);

  if (values.commit !== undefined && !path) {
    console.error("Usage: md-translate pull-updates <path> --commit <sha> [--apply] [--config <path>]");
    console.error("--commit requires <path> — one commit doesn't apply across many different files.");
    process.exit(1);
  }

  const manifestPaths = path
    ? [manifestPathFor(path, config.manifestDir)]
    : await globManifestPaths(config.root, config.manifestDir);

  if (manifestPaths.length === 0) {
    console.log("No manifest files found yet — nothing to check.");
    return;
  }

  let hasNotFound = false;
  for (const manifestPath of manifestPaths) {
    const entry = readManifestEntry(manifestPath);
    try {
      const { commit, content, newNodes, diff } = await diffAgainstUpstream(
        entry,
        values.commit,
        config.cacheDir,
        config.defaultBranch,
      );
      console.log(formatDiffReport(entry, commit, diff));

      if (values.apply && commit !== entry.source_commit) {
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
