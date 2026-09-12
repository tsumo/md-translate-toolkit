/**
 * Path conventions shared across the tools: building paths from the
 * resolved config's directories, plus the naming conventions derived
 * from a document's `original_path`.
 */
import { join } from "node:path";
import { glob } from "glob";

/** Absolute paths to every manifest entry file under `manifestDir`, sorted for a stable iteration order. */
export async function globManifestPaths(root: string, manifestDir: string): Promise<string[]> {
  const relativePaths = await glob(`${manifestDir}/**/*.json`, { cwd: root });
  return relativePaths.sort().map((relativePath) => join(root, relativePath));
}

/** Absolute paths to every translation file under `translationsDir`, sorted for a stable iteration order. */
export async function globTranslationPaths(root: string, translationsDir: string): Promise<string[]> {
  const relativePaths = await glob(`${translationsDir}/**/*.md`, { cwd: root });
  return relativePaths.sort().map((relativePath) => join(root, relativePath));
}

/**
 * A document's manifest entry path, relative to the project root, e.g.
 * `manifest/Foo.md.json`. `originalPath` is whatever the caller already
 * has on hand (a CLI argument, a request path) — this stays a plain
 * string template, not resolved against any particular directory.
 */
export function manifestPathFor(originalPath: string, manifestDir: string): string {
  return `${manifestDir}/${originalPath}.json`;
}

/** Inverse of `manifestPathFor`. `manifestPath` is relative to the project root. */
export function originalPathFromManifestPath(manifestPath: string, manifestDir: string): string {
  return manifestPath.slice(manifestDir.length + 1, -".json".length);
}

/**
 * A document's page path, relative to the site root, e.g.
 * `doc/reviewed/Foo.md.html`. A real `.html` file, not a directory with an
 * `index.html` inside it — this way the link works whether it is opened
 * over `file://`, any static server, or GitHub Pages, with no dependency
 * on a server's directory-index behavior.
 */
export function sitePathFor(originalPath: string): string {
  return `doc/${originalPath}.html`;
}

/** `sitePathFor`, URL-encoded for use in an `href`. */
export function hrefForDoc(originalPath: string): string {
  return encodeURI(sitePathFor(originalPath));
}

/**
 * Encodes each segment of `path` separately, so a literal `/` stays a
 * path separator instead of also being escaped. For a path used in a
 * GitHub URL, where per-segment encoding is stricter than `encodeURI`.
 */
export function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
