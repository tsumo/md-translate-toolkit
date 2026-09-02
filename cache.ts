/**
 * Local gitignored cache for fetched original files, keyed by commit+path.
 * Safe to cache indefinitely: content is addressed by an immutable commit
 * hash, so a cache hit is always valid (ADR-018).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CACHE_ROOT = ".cache/originals";
const MAX_ATTEMPTS = 4;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export class NotFoundError extends Error {
  constructor(description: string) {
    super(`Not found: ${description}`);
    this.name = "NotFoundError";
  }
}

function cachePath(commit: string, path: string): string {
  return join(CACHE_ROOT, commit, path);
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
  const res = await fetchWithRetry(url, `"${path}" at ${commit}`);
  const content = await res.text();

  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, content);

  return content;
}
