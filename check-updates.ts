/**
 * Read-only report: for every claimed document (or one path), fetches its
 * file at upstream HEAD and diffs it against the manifest's current
 * blocks. Nothing is written to disk — see `resync.ts` to actually apply
 * a diff.
 *
 * Usage: tsx tools/check-updates.ts [<path>]
 */
import { NotFoundError } from "./cache.js";
import { diffAgainstUpstream, formatDiffReport } from "./diff-upstream.js";
import { readManifestEntry } from "./manifest-io.js";
import { globManifestPaths, manifestPathFor } from "./paths.js";

async function main() {
  const path = process.argv[2];
  const manifestPaths = path ? [manifestPathFor(path)] : await globManifestPaths();

  if (manifestPaths.length === 0) {
    console.log("No manifest files found yet — nothing to check.");
    return;
  }

  let hasNotFound = false;
  for (const manifestPath of manifestPaths) {
    const entry = readManifestEntry(manifestPath);
    try {
      const { commit, diff } = await diffAgainstUpstream(entry, undefined);
      console.log(formatDiffReport(entry, commit, diff));
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
