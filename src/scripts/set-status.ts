/**
 * Sets the status of blocks in a manifest entry. A person decides the status (ADR-010). The command enforces
 * one rule: a block with a placeholder cannot be complete or verified (ADR-017).
 *
 * Usage: md-translate set-status [<path>] <status> [--block <index>] [--comment "..."]
 *   <path> is the original_path, such as "reviewed/Some File.md". In a terminal, a picker opens without it.
 *   No --block: all blocks change. A reviewer uses this to verify a whole file.
 *   --block <index>: only that block changes.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.js";
import { readManifestEntry, writeManifestEntry } from "../manifest-io.js";
import { manifestPathFor } from "../paths.js";
import { canPrompt, pickClaimedPath } from "../pick-path.js";
import { applyBlockStatus, isValidBlockStatus, VALID_BLOCK_STATUSES } from "../status.js";

const USAGE = 'Usage: md-translate set-status [<path>] <status> [--block <index>] [--comment "..."] [--config <path>]';

export async function runSetStatus(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { block: { type: "string" }, comment: { type: "string" }, config: { type: "string" } },
  });

  const config = await loadConfig(values.config);

  // One argument is the status. The picker gets the path.
  const [path, status] = positionals.length === 1 ? [undefined, positionals[0]] : positionals;
  if (!status) {
    console.error(USAGE);
    console.error(`<status> must be one of: ${VALID_BLOCK_STATUSES.join(" | ")}`);
    process.exit(1);
  }

  if (!isValidBlockStatus(status)) {
    console.error(`Invalid status "${status}". Must be one of: ${VALID_BLOCK_STATUSES.join(" | ")}`);
    process.exit(1);
  }

  const resolvedPath =
    path ?? (canPrompt() ? await pickClaimedPath({ includeAll: false }, config.root, config.manifestDir) : undefined);
  if (!resolvedPath) {
    console.error(USAGE);
    process.exit(1);
  }

  const manifestPath = manifestPathFor(resolvedPath, config.manifestDir);
  const entry = readManifestEntry(manifestPath);

  const targetIndices = values.block !== undefined ? [Number(values.block)] : entry.blocks.map((_, i) => i);

  const translationMarkdown = readFileSync(entry.translation_path, "utf-8");
  const result = applyBlockStatus(entry, translationMarkdown, targetIndices, status, values.comment);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }

  writeManifestEntry(manifestPath, entry);

  const target = values.block !== undefined ? `block ${values.block}` : `all ${targetIndices.length} blocks`;
  console.log(`${manifestPath}: ${target} → ${status}${values.comment ? ` ("${values.comment}")` : ""}`);
  console.log(`File status: ${result.fileStatus}`);
}
