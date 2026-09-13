/**
 * Types for the manifest format. See DECISIONS.md for the rationale
 * behind each field (ADR-001 commit pinning, ADR-006 linking mechanism,
 * ADR-013 status, ADR-015 fingerprint algorithm).
 */

/** A block's human-set status (ADR-013). */
export type BlockStatus = "in-progress" | "complete" | "verified" | "needs-attention";

/**
 * A block's kind and content fingerprint. A block's position (ADR-006) is
 * its index in `ManifestEntry.blocks`, not a field stored here.
 */
export interface BlockEntry {
  /** Top-level Markdown AST node type (heading, paragraph, list, table, etc.). */
  kind: string;
  /** sha256 of the block's normalized re-serialization, truncated to 16 hex chars. */
  fingerprint: string;
  status: BlockStatus;
  status_comment?: string;
}

/** A document's status, derived from its blocks. */
export type TranslationStatus = "not-started" | "in-progress" | "complete" | "verified" | "needs-attention";

/** One manifest entry: links a translation file to a pinned upstream original. */
export interface ManifestEntry {
  original_path: string;
  source_repo: string;
  source_commit: string;
  source_sha256: string;
  translation_path: string;
  /** ISO date (YYYY-MM-DD) this file was last checked against upstream. */
  last_synced: string;
  blocks: BlockEntry[];
}
