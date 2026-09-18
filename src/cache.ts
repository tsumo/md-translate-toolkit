/**
 * Local gitignored cache for fetched original files, keyed by commit+path.
 * Safe to cache indefinitely: content is addressed by an immutable commit
 * hash, so a cache hit is always valid.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { encodePathSegments } from "./paths.js";

const MAX_ATTEMPTS = 4;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export class NotFoundError extends Error {
  constructor(description: string) {
    super(`Not found: ${description}`);
    this.name = "NotFoundError";
  }
}

function cachePath(cacheDir: string, commit: string, path: string): string {
  return join(cacheDir, commit, path);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, description: string): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const outcome = await fetch(url).then(
      (res) => ({ res }),
      (err: unknown) => ({ err }),
    );
    if ("res" in outcome && outcome.res.ok) return outcome.res;
    if ("res" in outcome && outcome.res.status === 404) throw new NotFoundError(description);

    const retryable = "err" in outcome || RETRY_STATUS.has(outcome.res.status);
    const reason = "err" in outcome ? `${outcome.err}` : `${outcome.res.status} ${outcome.res.statusText}`;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`Failed to fetch ${description}: ${reason}`);
    }
    await sleep(2 ** attempt * 250);
  }
  throw new Error(`Failed to fetch ${description}: exhausted retries`);
}

/**
 * Resolves `commitArg` to a commit hash, or the current HEAD of `branch`
 * in `repo` if `commitArg` is not given.
 */
export async function resolveCommit(repo: string, commitArg: string | undefined, branch = "main"): Promise<string> {
  if (commitArg) return commitArg;
  const url = `https://api.github.com/repos/${repo}/commits/${branch}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to resolve HEAD commit (${branch}): ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { sha: string };
  return data.sha;
}

/**
 * Every Markdown file path in `repo` at `commit`, for a document picker.
 * Not cached to disk: the picker should reflect the tree at the commit
 * about to be pinned, and the list itself is cheap to fetch.
 */
export async function fetchRepoTree(repo: string, commit: string): Promise<string[]> {
  const url = `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`;
  const res = await fetchWithRetry(url, `repo tree for ${repo} at ${commit}`);
  const data = (await res.json()) as { tree: { path: string; type: string }[]; truncated: boolean };
  if (data.truncated) {
    console.error(`Warning: ${repo}'s tree at ${commit} is too large to list in full. Some files may be missing.`);
  }
  return data.tree.filter((entry) => entry.type === "blob" && entry.path.endsWith(".md")).map((entry) => entry.path);
}

/**
 * Returns `path` as it exists in `repo` at `commit`, reading from the
 * local cache when present and fetching (then caching) otherwise.
 */
export async function fetchOriginal(repo: string, commit: string, path: string, cacheDir: string): Promise<string> {
  const cached = cachePath(cacheDir, commit, path);
  if (existsSync(cached)) {
    console.log(`cache hit  ${commit.slice(0, 7)} ${path}`);
    return readFileSync(cached, "utf-8");
  }

  console.log(`fetching   ${commit.slice(0, 7)} ${path}`);
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${encodePathSegments(path)}`;
  const res = await fetchWithRetry(url, `"${path}" at ${commit}`);
  const content = await res.text();

  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, content);

  return content;
}
