# Architecture decisions

A log of the decisions about this toolkit, with the reason for each.

Each entry has a number, so other text can refer to it (for example "see ADR-007"). When a decision changes,
edit its entry in place. The log must always show the current state.

## How to write an ADR

Each ADR is one plain paragraph. It states the decision and the reason for it.

- Write in Simplified Technical English (ASD-STE100). Use short sentences of 20 words or fewer. Use the active
  voice. Use one name for one thing. Do not use contractions or semicolons.
- Keep only the big picture. Do not name files, functions, fields, or numbers, unless the reader needs them to
  understand the decision. The code shows those details.
- Keep each ADR short. Use about five sentences. If an ADR needs more, split it into two ADRs.
- Describe only the current decision. Do not list possible future changes. Put those in the TODO file.
- Write a title that states the decision.
- Refer to other ADRs by number only when the link helps the reader.
- Say "toolkit" for this project and "consumer project" for a repository that uses it.

### ADR-001: Commit pinning

The toolkit pins each document to its own upstream commit. It does not pin the whole upstream repository. This
lets each document move to a newer upstream version at its own time.

### ADR-003: Translation unit

The toolkit tracks and shows translations one block at a time, not one file at a time. A block is a top-level
Markdown element, such as a heading, a paragraph, a list, a table, a quote, a code block, or a divider. A whole
list is one block. The toolkit does not match the items inside a list on their own. Blocks are small enough to
track progress and upstream changes in detail.

### ADR-004: One translation file per document

Each original document has exactly one translation file. The translation file is a complete Markdown file that
a reader can use as it is. The toolkit never splits a large original into smaller files. Some translation files
will be very large. They will have thousands of blocks and large git diffs. The toolkit accepts this cost.

### ADR-005: No vendoring

A consumer project never commits original documents. The originals stay in a local cache that git ignores. The
toolkit downloads each original from upstream at its pinned commit when it needs the file. There is one
exception. Each placeholder in a translation file holds a short preview of its original text (ADR-007).

### ADR-006: Files are linked through the manifest

Neither the original nor the translation contains markers for the toolkit, so both files stay clean. The
manifest links them. It lists every block of the document in order, with the kind and fingerprint of each
block. A translation block matches an original block by position, and both must have the same kind. If the
kinds differ at a position, the toolkit reports the drift and a person must fix it. The manifest and translation
files keep the original path, so the toolkit must quote and encode paths with spaces.

### ADR-007: Translation skeleton with placeholders

When the toolkit adds a document, it creates the translation file with one placeholder for every block of the
original, in the same order. This keeps the translation aligned with the original from the start. Each
placeholder holds a fixed marker and a short preview of the original text, so a translator can read the file
without the original. A block is untranslated while its text starts with the marker. This check is separate
from the block status (ADR-013).

### ADR-008: Translators edit in their own editor

A translator edits the translation file in their own editor. A local dev server shows the original and the
translation side by side in a browser. The server reloads the page when a file changes.

### ADR-010: Applying updates changes translations

When upstream removes a block, `pull-updates --apply` deletes the matching translated block. It does not only
flag the block for review. Git history is the safety net, so a person can restore any deleted text. When
upstream changes a block that was complete or verified, the command sets that block to `needs-attention` and adds
a comment. Only that claim is out of date, so the rest of the document keeps its status. The command runs on one
document or on all documents.

### ADR-012: Structure drift fails the build

The `build` command fails if the block kinds of a translation differ from the original in any position. The
toolkit does not treat this as a warning. Every other feature matches blocks by position, so it needs the same
structure in both files. A consumer project should run `build` in CI, so a drifted translation cannot be merged.

### ADR-013: Block status is stored, document status is derived

Each block stores its own status, and a person sets it, because complete and verified are human judgments. A
block is in-progress (the start state), complete, verified, or needs-attention with a comment. The toolkit
derives the status of a document from its blocks and does not store it. One needs-attention block makes the
whole document needs-attention. A document is complete or verified only when every block is.

### ADR-015: Block fingerprints ignore formatting

The toolkit identifies the content of a block by a fingerprint. The fingerprint is a short hash of the block's
text. The toolkit makes this text from the block's syntax tree (AST), in one fixed format. A cosmetic edit, such as
a rewrapped line or a different bullet marker, does not change the fingerprint, so it does not count as a change.
The hash is short because it must only tell different blocks apart. It does not need to resist an attack.

### ADR-017: Upstream renames, deletions, and splits need a person

The toolkit does not fix a source file that upstream renamed, deleted, or split. It only reports the problem,
and a person resolves it. `pull-updates` finds the problem when the file is missing at the current upstream
version. It must tell a confirmed missing file from a temporary error, such as a rate limit. Otherwise it could
report a false rename. A pinned document is not affected, because its pinned commit always keeps the old file.

### ADR-019: Diff with a standard library algorithm

The toolkit finds upstream changes by comparing the old and new fingerprint lists with a standard library, not
a hand-written algorithm. A library scales to very large documents and handles edge cases, such as repeated
blocks. Between two matching runs, the toolkit pairs the leftover old and new blocks by position and marks them
as changed. This pairing is a guess. A changed block keeps its translation and gets a recheck. Only a
removed block loses its translation (ADR-010).

### ADR-021: Scripts and utility modules

Each source file is either a script or a utility module, never both. A script backs one command. It reads the
arguments, does the file and network work, and prints the result. A utility module holds plain functions that
scripts import. A script never imports another script, so shared logic goes into a utility module. Unit tests
cover the logic in utility modules, and end-to-end tests run the real commands on an example project.

### ADR-022: Command line only, configured by a file

The toolkit is a command line tool with one command, `md-translate`, and a subcommand for each task. It does
not export a library for other code. A consumer project sets its folders, its default upstream repository and
branch, and its license text in a config file. The config controls only identity and environment. It does not
change how the toolkit tracks translations, so every consumer project gets the same blocks, statuses, and diff.

### ADR-023: In-browser status changes

The dev server lets a translator change the status of one block in the browser. The built site has no server,
so it has no status control. The dev server and the `set-status` command share the same rules (ADR-024). Only
the command changes all blocks at once. The toolkit does not lock the manifest, so two tabs that change it at
the same time can overwrite each other.

### ADR-024: Completion claims must match the content

A block cannot be complete or verified while it still holds a placeholder. The `set-status` command and the dev
server refuse this change. The `build` command fails on a manifest that breaks the rule, because a person can
edit a manifest by hand. Other tools and readers trust these two states, so they must not be false.
