/**
 * Downloads every pinned original into the local cache, then verifies
 * each against its recorded checksum. The single script run after clone
 * ("run starting script to download originals"), reused by the local dev
 * server and the CI build.
 *
 * Usage: tsx tools/scripts/fetch-originals.ts
 */
import { createHash } from "node:crypto";
import { fetchOriginal } from "../cache.js";
import { readManifestEntry } from "../manifest-io.js";
import { globManifestPaths } from "../paths.js";

async function main() {
  const manifestPaths = await globManifestPaths();

  if (manifestPaths.length === 0) {
    console.log("No manifest files found yet — nothing to fetch.");
    return;
  }

  let hasErrors = false;

  for (const manifestPath of manifestPaths) {
    const entry = readManifestEntry(manifestPath);
    try {
      const content = await fetchOriginal(entry.source_repo, entry.source_commit, entry.original_path);
      const sha256 = createHash("sha256").update(content).digest("hex");
      if (sha256 !== entry.source_sha256) {
        hasErrors = true;
        console.error(
          `checksum mismatch: "${entry.original_path}" at ${entry.source_commit} doesn't match source_sha256`,
        );
      }
    } catch (err) {
      hasErrors = true;
      console.error(String(err));
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
