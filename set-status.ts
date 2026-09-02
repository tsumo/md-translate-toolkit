/**
 * Sets block status within a manifest entry. Status is otherwise a human
 * judgment call (ADR-015) — the one thing enforced here is that
 * "complete"/"verified" can't be claimed for a block that still holds a
 * placeholder, since those two states are strong claims other tooling and
 * readers will trust.
 *
 * Usage: tsx tools/set-status.ts <path> <status> [--block <index>] [--comment "..."]
 *   <path> is the original_path, e.g. "reviewed/Some File.md"
 *   No --block: applies to every block (the common case — a reviewer
 *   finishing a whole file marks it verified in one shot).
 *   --block <index>: applies to just that one block (flagging a single
 *   suspect paragraph, or fixing one after review).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { truncatedList } from "./diff-upstream.js";
import { readManifestEntry, writeManifestEntry } from "./manifest-io.js";
import { manifestPathFor } from "./paths.js";
import { parseBlocks, translationProgress } from "./split-blocks.js";
import { deriveFileStatus, isInvalidCompletion, isValidBlockStatus, VALID_BLOCK_STATUSES } from "./status.js";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { block: { type: "string" }, comment: { type: "string" } },
});

const [path, status] = positionals;
if (!path || !status) {
  console.error('Usage: tsx tools/set-status.ts <path> <status> [--block <index>] [--comment "..."]');
  console.error(`<status> must be one of: ${VALID_BLOCK_STATUSES.join(" | ")}`);
  process.exit(1);
}

if (!isValidBlockStatus(status)) {
  console.error(`Invalid status "${status}". Must be one of: ${VALID_BLOCK_STATUSES.join(" | ")}`);
  process.exit(1);
}

if (status === "needs-attention" && !values.comment) {
  console.error('"needs-attention" should have --comment explaining what needs attention.');
  process.exit(1);
}

const manifestPath = manifestPathFor(path);
const entry = readManifestEntry(manifestPath);

const targetIndices = values.block !== undefined ? [Number(values.block)] : entry.blocks.map((b) => b.index);

for (const index of targetIndices) {
  if (!entry.blocks[index]) {
    console.error(`No block at index ${index} (file has ${entry.blocks.length} blocks, 0-indexed).`);
    process.exit(1);
  }
}

const translationNodes = parseBlocks(readFileSync(entry.translation_path, "utf-8"));
const stillPlaceholder = targetIndices.filter((index) => isInvalidCompletion(status, translationNodes[index]));
if (stillPlaceholder.length > 0) {
  console.error(
    `Cannot set "${status}": block(s) ${truncatedList(stillPlaceholder)} still hold a placeholder in ${entry.translation_path}.`,
  );
  process.exit(1);
}

for (const index of targetIndices) {
  entry.blocks[index].status = status;
  entry.blocks[index].status_comment = values.comment;
}

writeManifestEntry(manifestPath, entry);

const progress = translationProgress(readFileSync(entry.translation_path, "utf-8"));
const fileStatus = deriveFileStatus(entry.blocks, progress);

const target = values.block !== undefined ? `block ${values.block}` : `all ${targetIndices.length} blocks`;
console.log(`${manifestPath}: ${target} → ${status}${values.comment ? ` ("${values.comment}")` : ""}`);
console.log(`File status: ${fileStatus}`);
