import { relative } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import { search } from "@inquirer/prompts";
import { fetchRepoTree } from "./cache.js";
import { globManifestPaths, originalPathFromManifestPath, PROJECT_ROOT } from "./paths.js";

/** True iff stdin and stdout are both a real terminal, so a prompt can run. */
export function canPrompt(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** Every already-claimed document's `original_path`, sorted. */
export async function listClaimedPaths(): Promise<string[]> {
  const manifestPaths = await globManifestPaths();
  return manifestPaths.map((path) => originalPathFromManifestPath(relative(PROJECT_ROOT, path))).sort();
}

/** Case-insensitive substring filter, for the picker's filter-as-you-type search. */
function filterByTerm(paths: string[], term: string | undefined): string[] {
  if (!term) return paths;
  const needle = term.toLowerCase();
  return paths.filter((path) => path.toLowerCase().includes(needle));
}

/** Sentinel value for the "all documents" choice. A real `original_path` is never empty. */
const ALL_DOCUMENTS = "";

/**
 * Prompts for one already-claimed document. `includeAll: true` adds an
 * "all documents" choice, returned as `undefined` — the value these tools
 * already use to mean "don't filter by path".
 */
export async function pickClaimedPath(options: { includeAll: true }): Promise<string | undefined>;
export async function pickClaimedPath(options: { includeAll: false }): Promise<string>;
export async function pickClaimedPath(options: { includeAll: boolean }): Promise<string | undefined> {
  const paths = await listClaimedPaths();
  const choice = await runPrompt(() =>
    search<string>({
      message: "Which document?",
      source: (term) => {
        const matches = filterByTerm(paths, term).map((path) => ({ value: path }));
        return options.includeAll && !term ? [{ value: ALL_DOCUMENTS, name: "All documents" }, ...matches] : matches;
      },
    }),
  );
  return choice === ALL_DOCUMENTS ? undefined : choice;
}

/** Upstream paths not yet claimed by any manifest entry. */
export function filterUnclaimed(treePaths: string[], claimedPaths: string[]): string[] {
  const claimed = new Set(claimedPaths);
  return treePaths.filter((path) => !claimed.has(path)).sort();
}

/** Prompts for one upstream Markdown file at `commit`, not yet claimed by any manifest entry. */
export async function pickUpstreamPath(repo: string, commit: string): Promise<string> {
  const [treePaths, claimedPaths] = await Promise.all([fetchRepoTree(repo, commit), listClaimedPaths()]);
  const unclaimed = filterUnclaimed(treePaths, claimedPaths);
  return runPrompt(() =>
    search<string>({
      message: "Which upstream file?",
      source: (term) => filterByTerm(unclaimed, term).map((path) => ({ value: path })),
    }),
  );
}

/** Runs an inquirer prompt. Turns a Ctrl+C cancel into a clean exit, not a stack trace. */
async function runPrompt<T>(prompt: () => Promise<T>): Promise<T> {
  try {
    return await prompt();
  } catch (err) {
    if (err instanceof ExitPromptError) {
      console.error("Cancelled.");
      process.exit(130);
    }
    throw err;
  }
}
