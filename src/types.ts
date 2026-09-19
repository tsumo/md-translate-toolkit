/** Types for the manifest format. DECISIONS.md gives the reasons for them. */

/** The status of a block. A person sets it (ADR-010). */
export type BlockStatus = "in-progress" | "complete" | "verified" | "needs-attention";

/** The kind and fingerprint of a block. Its position is its index in `ManifestEntry.blocks` (ADR-005). */
export interface BlockEntry {
  /** Top-level Markdown node type, such as heading or paragraph. */
  kind: string;
  /** Short hash of the normalized text of the block (ADR-011). */
  fingerprint: string;
  status: BlockStatus;
  status_comment?: string;
}

/** The status of a document. The toolkit derives it from the blocks. */
export type TranslationStatus = "not-started" | "in-progress" | "complete" | "verified" | "needs-attention";

/** Links a translation file to a pinned upstream original. */
export interface ManifestEntry {
  original_path: string;
  source_repo: string;
  source_commit: string;
  source_sha256: string;
  translation_path: string;
  /** Date (YYYY-MM-DD) of the last check against upstream. */
  last_synced: string;
  blocks: BlockEntry[];
}
