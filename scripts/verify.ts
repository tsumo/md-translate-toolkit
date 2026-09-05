/**
 * Verifies manifest entries against their pinned original and translation
 * file: sha256/fingerprint integrity, translation block-kind alignment,
 * and the complete/verified completeness gate. Also cross-checks the
 * manifest/ and translations/ trees against each other. Hard failure on
 * any mismatch, no auto-fix (ADR-014, ADR-015).
 *
 * Usage: tsx tools/scripts/verify.ts [<path>]
 *   <path>: verify just this manifest entry (original_path). Omit to
 *   verify every entry under manifest/. In a terminal, omitting <path>
 *   opens a document picker instead.
 */
import { globManifestPaths, manifestPathFor } from "../paths.js";
import { canPrompt, pickClaimedPath } from "../pick-path.js";
import { verifyAll } from "../verify-checks.js";

async function main() {
  const path = process.argv[2] ?? (canPrompt() ? await pickClaimedPath({ includeAll: true }) : undefined);
  const manifestPaths = path ? [manifestPathFor(path)] : await globManifestPaths();

  if (manifestPaths.length === 0) {
    console.log("No manifest files found yet — nothing to verify.");
    return;
  }

  const { hasErrors } = await verifyAll(manifestPaths, !path);
  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
