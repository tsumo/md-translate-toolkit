/**
 * Local gitignored cache for fetched original files, keyed by commit+path.
 * Safe to cache indefinitely: content is addressed by an immutable commit
 * hash, so a cache hit is always valid (ADR-018).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CACHE_ROOT = ".cache/originals";

function cachePath(commit: string, path: string): string {
  return join(CACHE_ROOT, commit, path);
}

/**
 * Returns `path` as it exists in `repo` at `commit`, reading from the
 * local cache when present and fetching (then caching) otherwise.
 */
export async function fetchOriginal(repo: string, commit: string, path: string): Promise<string> {
  const cached = cachePath(commit, path);
  if (existsSync(cached)) {
    console.log(`cache hit  ${commit.slice(0, 7)} ${path}`);
    return readFileSync(cached, "utf-8");
  }

  console.log(`fetching   ${commit.slice(0, 7)} ${path}`);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${encodedPath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch "${path}" at ${commit}: ${res.status} ${res.statusText}`);
  }
  const content = await res.text();

  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, content);

  return content;
}
