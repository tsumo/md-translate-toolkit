/** Path rules that all commands share: folders from the config, and names that come from `original_path`. */
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { glob } from "glob";

/** Absolute paths of all manifest files, sorted. */
export async function globManifestPaths(root: string, manifestDir: string): Promise<string[]> {
  const relativePaths = await glob(`${manifestDir}/**/*.json`, { cwd: root });
  return relativePaths.sort().map((relativePath) => join(root, relativePath));
}

/** Absolute paths of all translation files, sorted. */
export async function globTranslationPaths(root: string, translationsDir: string): Promise<string[]> {
  const relativePaths = await glob(`${translationsDir}/**/*.md`, { cwd: root });
  return relativePaths.sort().map((relativePath) => join(root, relativePath));
}

/** The manifest path of a document, relative to the project root, such as `manifest/Foo.md.json`. */
export function manifestPathFor(originalPath: string, manifestDir: string): string {
  return `${manifestDir}/${originalPath}.json`;
}

/**
 * True when a client-supplied original path resolves to a manifest file inside `manifestDir`. Unchecked, a
 * crafted value such as `../secrets` reads or writes files outside the manifest folder. Absolute paths are
 * always refused.
 */
export function isSafeOriginalPath(originalPath: string, manifestDir: string): boolean {
  if (isAbsolute(originalPath)) return false;
  const manifestPath = resolve(manifestPathFor(originalPath, manifestDir));
  const relFromManifestDir = relative(resolve(manifestDir), manifestPath);
  return !relFromManifestDir.split(sep).includes("..");
}

/** The reverse of `manifestPathFor`. */
export function originalPathFromManifestPath(manifestPath: string, manifestDir: string): string {
  return manifestPath.slice(manifestDir.length + 1, -".json".length);
}

/**
 * The page path of a document, relative to the site root, such as `doc/reviewed/Foo.md.html`. It is a real
 * `.html` file, so the link works from `file://` and from any static server.
 */
export function sitePathFor(originalPath: string): string {
  return `doc/${originalPath}.html`;
}

/** `sitePathFor`, URL-encoded for an `href`. */
export function hrefForDoc(originalPath: string): string {
  return encodeURI(sitePathFor(originalPath));
}

/** Encodes each segment of `path` on its own, so `/` stays a separator. GitHub URLs need this. */
export function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
