/**
 * Anchors filesystem discovery to the project root, not the process's
 * working directory — a script run from a different directory must still
 * find the same manifest files (and, for anything destructive, must not
 * mistake some other directory's `site/` for this project's).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";

export const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Absolute paths to every manifest entry file, sorted for a stable iteration order. */
export async function globManifestPaths(): Promise<string[]> {
  const relativePaths = await glob("manifest/**/*.json", { cwd: PROJECT_ROOT });
  return relativePaths.sort().map((relativePath) => join(PROJECT_ROOT, relativePath));
}
