/**
 * Shared types for the manifest format. See TODO.md Phase 1 for the
 * schema this mirrors, and DECISIONS.md for the rationale behind each
 * field (ADR-001 commit pinning, ADR-006 linking mechanism, ADR-015
 * status, ADR-017 fingerprint algorithm).
 */

/** A block's position and kind within a document, plus a content fingerprint. */
export interface BlockEntry {
  index: number;
  /** Top-level Markdown AST node type (heading, paragraph, list, table, etc.). */
  kind: string;
  /** sha256 of the block's normalized re-serialization, truncated to 16 hex chars. */
  fingerprint: string;
}

export type TranslationStatus =
  | "not-started"
  | "in-progress"
  | "complete"
  | "verified"
  | "needs-attention";

/** One manifest entry: links a translation file to a pinned upstream original. */
export interface ManifestEntry {
  original_path: string;
  source_repo: string;
  source_commit: string;
  source_sha256: string;
  translation_path: string;
  status: TranslationStatus;
  status_comment?: string;
  /** ISO date (YYYY-MM-DD) `resync.ts` (or `add-source.ts` at claim time) last ran. */
  last_synced: string;
  blocks: BlockEntry[];
}
