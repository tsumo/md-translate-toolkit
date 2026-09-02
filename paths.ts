/**
 * Path conventions shared across the tools: anchoring filesystem discovery
 * to the project root, not the process's working directory (a script run
 * from a different directory must still find the same manifest files, and,
 * for anything destructive, must not mistake some other directory's
 * `site/` for this project's), plus the naming conventions derived from a
 * document's `original_path`.
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

/** Absolute paths to every translation file, sorted for a stable iteration order. */
export async function globTranslationPaths(): Promise<string[]> {
  const relativePaths = await glob("translations/**/*.md", { cwd: PROJECT_ROOT });
  return relativePaths.sort().map((relativePath) => join(PROJECT_ROOT, relativePath));
}

/**
 * A document's manifest entry path, relative to the project root, e.g.
 * `manifest/reviewed/Foo.md.json`. `originalPath` is whatever the caller
 * already has on hand (a CLI argument, a request path) — this stays a
 * plain string template, not resolved against any particular directory.
 */
export function manifestPathFor(originalPath: string): string {
  return `manifest/${originalPath}.json`;
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
