import { relative } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import { search } from "@inquirer/prompts";
import { fetchRepoTree } from "./cache.js";
import { globManifestPaths, originalPathFromManifestPath } from "./paths.js";

/** True when stdin and stdout are both a real terminal, so a prompt can run. */
export function canPrompt(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** The `original_path` of each claimed document, sorted. */
export async function listClaimedPaths(root: string, manifestDir: string): Promise<string[]> {
  const manifestPaths = await globManifestPaths(root, manifestDir);
  return manifestPaths.map((path) => originalPathFromManifestPath(relative(root, path), manifestDir)).sort();
}

/** Case-insensitive filter for the search as you type. */
function filterByTerm(paths: string[], term: string | undefined): string[] {
  if (!term) return paths;
  const needle = term.toLowerCase();
  return paths.filter((path) => path.toLowerCase().includes(needle));
}

/** Value of the "all documents" choice. A real `original_path` is never empty. */
const ALL_DOCUMENTS = "";

/** Asks for one claimed document. With `includeAll: true`, an "all documents" choice returns `undefined`. */
export async function pickClaimedPath(
  options: { includeAll: true },
  root: string,
  manifestDir: string,
): Promise<string | undefined>;
export async function pickClaimedPath(
  options: { includeAll: false },
  root: string,
  manifestDir: string,
): Promise<string>;
export async function pickClaimedPath(
  options: { includeAll: boolean },
  root: string,
  manifestDir: string,
): Promise<string | undefined> {
  const paths = await listClaimedPaths(root, manifestDir);
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

/** Upstream paths that no manifest entry claims. */
export function filterUnclaimed(treePaths: string[], claimedPaths: string[]): string[] {
  const claimed = new Set(claimedPaths);
  return treePaths.filter((path) => !claimed.has(path)).sort();
}

/** Asks for one unclaimed upstream Markdown file at `commit`. */
export async function pickUpstreamPath(
  repo: string,
  commit: string,
  root: string,
  manifestDir: string,
): Promise<string> {
  const [treePaths, claimedPaths] = await Promise.all([
    fetchRepoTree(repo, commit),
    listClaimedPaths(root, manifestDir),
  ]);
  const unclaimed = filterUnclaimed(treePaths, claimedPaths);
  return runPrompt(() =>
    search<string>({
      message: "Which upstream file?",
      source: (term) => filterByTerm(unclaimed, term).map((path) => ({ value: path })),
    }),
  );
}

/** Runs a prompt. A Ctrl+C cancel exits cleanly, with no stack trace. */
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
