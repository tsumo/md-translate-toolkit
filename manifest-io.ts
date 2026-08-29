/**
 * Read/write manifest entries with a canonical field order.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BlockEntry, ManifestEntry } from "./types.js";

function canonicalBlock(block: BlockEntry): BlockEntry {
  return {
    index: block.index,
    kind: block.kind,
    fingerprint: block.fingerprint,
    status: block.status,
    ...(block.status_comment !== undefined
      ? { status_comment: block.status_comment }
      : {}),
  };
}

function canonicalEntry(entry: ManifestEntry): ManifestEntry {
  return {
    original_path: entry.original_path,
    source_repo: entry.source_repo,
    source_commit: entry.source_commit,
    source_sha256: entry.source_sha256,
    translation_path: entry.translation_path,
    last_synced: entry.last_synced,
    blocks: entry.blocks.map(canonicalBlock),
  };
}

export function readManifestEntry(manifestPath: string): ManifestEntry {
  return JSON.parse(readFileSync(manifestPath, "utf-8"));
}

export function writeManifestEntry(
  manifestPath: string,
  entry: ManifestEntry,
): void {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    JSON.stringify(canonicalEntry(entry), null, 2) + "\n",
  );
}
