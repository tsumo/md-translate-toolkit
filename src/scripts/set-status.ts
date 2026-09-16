/**
 * Sets block status within a manifest entry. Status is otherwise a human
 * judgment call (ADR-013) — the one thing enforced here is that
 * "complete"/"verified" can't be claimed for a block that still holds a
 * placeholder, since those two states are strong claims other tooling and
 * readers will trust.
 *
 * Usage: md-translate set-status [<path>] <status> [--block <index>] [--comment "..."]
 *   <path> is the original_path, e.g. "reviewed/Some File.md". In a
 *   terminal, omitting <path> opens a document picker instead.
 *   No --block: applies to every block (the common case — a reviewer
 *   finishing a whole file marks it verified in one shot).
 *   --block <index>: applies to just that one block (flagging a single
 *   suspect paragraph, or fixing one after review).
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

  // One positional given means it's <status>, with <path> left for the picker below.
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
