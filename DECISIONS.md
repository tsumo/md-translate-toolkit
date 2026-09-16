# Architecture decisions

A running log of the decisions made while designing this project's infrastructure, with the rationale behind
each.

Each entry is numbered for stable reference (e.g. "see ADR-007"). Entries are edited in place when a decision
changes, to keep this log accurate.

### ADR-001: Commit pinning

The manifest pins each file, not the whole repository. Each manifest entry has its own `source_commit` and
`source_sha256`. This lets a file update to a newer upstream version on its own.

### ADR-002: Toolchain

All scripts and the static-site build use Node.js and TypeScript. Scripts run through `tsx`. CI uses
`tsc --noEmit` as a type-check gate. These tools constantly pass around shape-heavy data: manifest entries,
blocks, and diff and apply results. The compiler catches a mismatched field name or a wrong shape before it
corrupts a manifest, not only at runtime.

### ADR-003: Translation unit

Internal tracking and rendering use paragraph and heading blocks, not the whole file, as the unit of
granularity. Remark parses each file into a Markdown AST. A block is a top-level node in that AST: a heading,
paragraph, list, table, blockquote, or code block. List items are not aligned on their own.

### ADR-004: One translation file per original file — no chunking

Each translation file must be a single, ready-to-use `.md` file that mirrors its original file one to one.
Tools do not auto-split large sources into per-chapter files, not even the 2.4MB Core Rules. Some translation
files will be very large, with thousands of blocks and large git diffs.

### ADR-005: No vendoring

This repository never commits full original files. These files only exist in a gitignored local cache. The
tools download them from GitHub on demand, at the pinned commit.

ADR-007 makes one narrow, deliberate exception to this rule. Each skeleton block's placeholder includes a short
preview of the original text, truncated to about 80 characters. This preview makes a skeleton file readable
without the side-by-side view. The manifest's block-level fingerprints remain the real link back to the source.

### ADR-006: Linking mechanism — zero-clutter files

Neither the original file nor the translation `.md` file has inline markers or comments for tooling. The
manifest holds `source_commit` and `source_sha256` at the file level. The manifest also holds the full ordered
block list. Each block entry has a `kind` and `fingerprint` for linking, plus a `status` (ADR-013). The original
and the translation match up purely by position in this list, not by a stored field. The same splitter parses
both files, and blocks pair up by position plus `kind`.

A `kind` mismatch at some position means the translation's block structure no longer matches the original. This
can happen if someone merges or splits a block, or if upstream restructures the document. The tool flags this
for manual reconciliation. It does not fix the mismatch on its own. There is no override for an intentional 1:N
or N:1 block merge yet.

### ADR-007: WIP skeleton

`add-source.ts` generates the translation file with the full block structure up front. It creates a slot for
every heading, paragraph, list, and table, in the original order. Each slot holds a placeholder: the marker
`(не переведено)`, followed by a preview of that block's original text. The preview is truncated to about 80
characters, cut at a word boundary, and this is ADR-005's one exception to the no-vendoring rule. This approach
keeps positional alignment correct from day one. It also gives translators a readable fill-in-the-blank outline,
instead of a wall of identical markers.

A block counts as untranslated only if its text still starts with the marker (`isUntranslated`,
`split-blocks.ts`). This check ignores whatever preview text follows the marker. Do not confuse this check
with `BlockEntry.status` (ADR-013), which is a separate, human-set field. The prefix check still works even
after a translator deletes the marker and preview together. Translators replace each placeholder in place.

### ADR-008: Editing UX

A translator edits the translation `.md` file in their own editor. A local dev server watches for changes. It
live-reloads a browser tab that renders the original and the translation side by side. The dev server builds this
view by zipping blocks together by position.

### ADR-009: File naming

File names mirror the original file names exactly, including spaces and parentheses. For example:
`manifest/reviewed/Ars Magica - Definitive Edition (Core Rules).md.json` and `translations/reviewed/Ars Magica
- Definitive Edition (Core Rules).md`. Tooling must quote and escape these paths carefully everywhere, including
in shell commands and in URLs on the generated Pages site.

### ADR-010: Resync is destructive by design

When upstream removes a block, `npm run pull-updates --apply` auto-deletes the matching translated block. It
does not just flag the block for review. Git history is the safety net.

`--apply` with no `<path>` can touch every claimed document in one run, not only one. The same rule applies:
git history is the safety net, for every file the run touches, not only one.

### ADR-011: No persisted "needs review" state

`npm run pull-updates` is a read-only check that reports what has changed upstream, without touching anything.
`--apply` is the real update: it applies that same diff, through the same shared diff engine (ADR-021). The
manifest stores nothing about what changed since the last sync. Re-running the check against the current
upstream HEAD is cheap enough to serve as the source of truth.

### ADR-012: Structural drift is a hard CI failure

If a translation's block-kind sequence differs from the original's, CI treats this as a hard failure, not a
warning. The positional-alignment invariant must hold at all times. Build, pull-updates, and rendering all
depend on it.

### ADR-013: Status lives on the block, not the file — file status is derived

Status lives on the block, not the file. Each block stores its own status in `BlockEntry.status`, and a human
sets it. A block can be `in-progress`, `complete`, `verified`, or `needs-attention` with a comment. `in-progress`
is the default state. It means the block still holds a placeholder, or a translator has drafted it but not yet
confirmed it. A block has no `not-started` state, because a single block has no smaller unit to track
separately from `in-progress`.

The manifest stores this field per block, instead of deriving it, for a reason. `verified`, `complete`, and
`needs-attention` are judgment calls. The field must hold real, human-given data.

`ManifestEntry` carries no `status` field at all. Tools always derive a document's file-level status from its
blocks, using `deriveFileStatus` in `status.ts`. This function combines the blocks' stored statuses with a
content scan from `translationProgress`. The scan makes one distinction the stored field cannot make on its
own. The rule works like this:

- If any block is `needs-attention`, the file status is `needs-attention`. This overrides every other block
  state.
- Else if every block is `verified`, the file status is `verified`.
- Else if every block is `complete` or `verified`, the file status is `complete`.
- Else if no block has any real content yet (every block still holds a placeholder), the file status is
  `not-started`.
- Else, the file status is `in-progress`. This is the only case where `in-progress` means a mix of done and
  not-done blocks. At block level, `in-progress` only means pending.

One rule is enforced, not left to human judgment. A block cannot be set to `complete` or `verified` while it
still holds the untranslated marker (`isUntranslated`, `split-blocks.ts`). `set-status.ts` refuses the
change otherwise, for a single block or, in bulk mode (no `--block` flag), for every block. `complete` and
`verified` are strong claims that other tooling and readers will trust, so they must not lie about a block's
actual content. `build.ts` enforces this same check as a CI gate, because a hand-edited manifest JSON can
bypass `set-status.ts` entirely.

`npm run pull-updates --apply` auto-downgrades a block to `needs-attention` whenever it finds an upstream change that
touches that block. It adds an auto-generated comment when it does this. This downgrade is precise to the block
that changed. It is not a blunt, whole-file downgrade. Only that one block's `complete` or `verified` claim has
actually gone stale.

The manifest has no explicit `claimed_by` or `assignee` field. GitHub issues and PRs handle that coordination
instead.

### ADR-014: Translated files strictly mirror the original's structure

A translated file has no inline tooling markers (ADR-006) and no license or attribution footer. CC BY-SA 4.0
requires attribution, but this repository meets that requirement elsewhere. `README.md` and `LICENSE.md` state
it at the repository level, and the generated Pages site shows it in the page chrome. This chrome is built
output, not the source `.md` file, so it does not break the mirror rule. Attribution never appears inside a
translated file itself.

### ADR-015: Fingerprint algorithm

The fingerprint is a sha256 hash of the block's AST. `remark-stringify` re-serializes this AST with fixed,
normalized options: consistent bullet and emphasis markers, no line-wrapping, and a consistent heading style.
The tool truncates the hash to 16 hex characters, or 64 bits. This is collision-free even at the
thousands-of-blocks scale the biggest files reach. This is not a security context, so the full digest is not
needed.

The tool re-serializes the AST instead of hashing a raw source slice. This means a purely cosmetic edit, like a
rewrapped line or a bullet-marker change, does not trigger a false "changed" flag.

### ADR-016: CI caching

CI caches `.cache/originals/` across runs, using `actions/cache`. The cache key is
`hashFiles('manifest/**/*.json')`, which changes exactly when a `source_commit` changes. A generic restore-key
fallback allows partial reuse. This cache is safe because each entry is content-addressed by an immutable
commit, so a cache hit is always valid. `build.ts` also re-checks the sha256, whether the content comes from
the cache or a fresh fetch, so the cache cannot introduce a correctness bug.

This cache mainly protects against `raw.githubusercontent.com` rate limits, as the manifest grows toward 60+
files. `pull-updates` is on-demand only (ADR-011). It always fetches upstream's current HEAD, which the tool
never caches. This means the live-fetch path still gets exercised every time someone runs `pull-updates`,
regardless of this cache.

### ADR-017: Upstream renaming/deleting/splitting a source file entirely

Renaming, deleting, or splitting a source file is different from editing its content. The tools do not automate
a fix for this. They only detect it and report it. A human must resolve it manually. This case only matters for
`pull-updates` (plain, or with `--apply`), when it checks against upstream's current HEAD. An already-pinned
file is fetched by its immutable commit hash. So a later rename, delete, or split upstream can never break
`build.ts` for content already pinned here. That blob exists forever at that commit.

`diff-upstream.ts` must tell apart a confirmed 404 from a transient fetch error, like a rate limit or a network
blip. A confirmed 404 means the path is gone at the upstream HEAD. Confusing the two causes real problems. A bad
run could wrongly declare a file orphaned. Or the tool could silently treat a real rename as a retryable error.
`pull-updates` reports a confirmed 404 as its own category, separate from "content changed," renaming is not
automatic.

A human checks the upstream repository history and resolves the issue by editing the manifest directly. This
means repointing `original_path` and rerunning `add-source.ts`-style logic, or removing the entry.

### ADR-018: Deployment is out of scope

`build` produces a static site under `siteDir` (default `site/`) and stops there. This package ships no deploy
workflow, no push credentials, and no assumption about where the site is hosted or how it gets there.

### ADR-019: Diff algorithm — Myers, not a hand-rolled LCS

`diff-upstream.ts` diffs the old and new block-fingerprint lists with the `diff` package's `diffArrays`, an
implementation of Myers' algorithm. A hand-rolled O(n²) dynamic-programming LCS does not scale to this
project. The biggest file has about 9,500 blocks. That table would need about 90 million cells.

A mature library also avoids a subtle class of bug. A sequence-diff algorithm has many edge cases: element
order, duplicate values, and boundary conditions.

Measured against the ~9,500-block Core Rulebook, the diff completes in about 3 milliseconds.

Leftover blocks inside one gap pair by position, oldest first on each side. This is a heuristic, not a
certainty. A large removal next to a large insertion can pair unrelated blocks together. The tool accepts
this trade-off. A "changed" pairing carries an existing translation forward and flags it for a human recheck,
not for deletion. Only a true "removed" block discards content, by design (ADR-010).

### ADR-020: Interactive document picker

Three tools accept a document path: `add-source`, `set-status`, and `pull-updates`. Typing a full path by hand
is slow and error-prone. Original file names are long, and they contain spaces and parentheses (ADR-009).

`pick-path.ts` adds an interactive picker, built on the `@inquirer/prompts` package's filter-as-you-type
search prompt. This scales better than a plain arrow-key list once the manifest grows toward 60+ documents.

The picker only runs when a path is missing, and only when both stdin and stdout are a real terminal. A typed
path always skips the picker. This keeps every script safe for CI and for scripting. A non-interactive run
never blocks on a prompt.

A typed path stays available everywhere, even though no CI job or hook ever passes one. In a tight
edit-then-build loop, shell history recall beats re-navigating the picker on every rerun. This costs real
complexity only in `set-status.ts`, where a single positional argument must resolve to `<status>` instead of
`<path>`.

`pull-updates` already treats a missing path as "check every document," for both the report and `--apply`. The
picker keeps this mode as an explicit "All documents" choice, not a removed feature.

`add-source` picks from a different source than the other two tools. Those two pick among already-claimed
manifest entries. `add-source` claims a new file instead, so it lists the upstream repository's own file tree
at the resolved commit, filtered to Markdown files not already claimed.

### ADR-021: Scripts vs. utility modules

Each file in this repository is either a script or a utility module, never both. A script exports one entry
function (for example `runBuild`). This function parses its own `argv`, does file or network I/O, prints to
the console, and can call `process.exit`. A utility module holds plain functions with no entry point of its
own, meant for a script to import.

This split is physical, not just a naming convention. Scripts live under `src/scripts/`. Utility modules,
and every `.test.ts` file, stay directly under `src/`. `cli.js` is the single CLI entry point (ADR-022),
and the only plain-JavaScript file in this repository — it registers a loader before it can import anything
else here, so it cannot itself be one of the TypeScript files that loader is for. It reads the subcommand name
from `process.argv`, maps it to a script's entry function, and calls that function with the rest of the argv.
`cli.js` ends with `main().catch((err) => { console.error(err); process.exit(1); })`. No script under
`src/scripts/` has this tail. `dev.ts`'s entry function starts a long-lived server, so it does not resolve
until the process exits.

A script exports its entry function only for `cli.js` to call. No script imports another script's entry
function directly. When two scripts need the same logic, that logic moves into a new or existing utility
module instead.

A CLI command does not need its own script file. `build.ts` runs the shape check from `manifest-schema.ts`
and the content check from `verify-checks.ts` itself, rather than shelling out to a separate script for
each. `pull-updates.ts` backs its command the same way, with `--apply` as a flag (see ADR-011).

A test file always targets a utility module. A script's own CLI concerns, argument parsing, printed output,
and exit codes, are not unit tested directly.

### ADR-022: CLI-only interface, no library export

The package exposes a CLI only. It has one binary, `md-translate`, with subcommands (`build`, `add-source`,
`dev`, `set-status`, `pull-updates`). It does not export a library for other code to import.

A consumer repository sets paths, a default upstream repo and branch, and license text in a config file. This
file is plain JavaScript, typed through a JSDoc comment against a type the package exports. The CLI reads this
file from the working directory. A `--config` flag can point at a different file instead.

Config controls only identity and environment. It does not control the tool's translation method. Block
granularity, the 4-state status model, and the diff algorithm stay fixed across every consumer.

### ADR-023: In-browser status changes

ADR-008 restricted the browser to rendering. This adds the browser's first write path: each block on the dev
server's document page gets its own status badge and a plain `<form method="post" action="/api/status">`, with
no client JS, matching the project's zero-framework, template-literal rendering. Submitting it writes the
manifest and 302-redirects back to the same page.

The static build never emits this form. `renderDocumentBody`/`renderDocumentPage` take an `editable` flag that
defaults to off; `build.ts` doesn't pass it, so its output is byte-identical to before this change. This
feature works only against a locally running dev server — the deployed static site (ADR-018) has no server
behind it to receive the POST.

The actual validation and mutation (reject an out-of-range index, require a comment for `needs-attention`,
refuse `complete`/`verified` on a still-placeholder block, mutate the block(s), derive the new file status) is
one function, `applyBlockStatus` in `status.ts`, shared between `set-status.ts` and this endpoint (ADR-021).
Page-level "apply to all blocks" stays CLI-only for now — each block on the page gets its own control, not a
bulk one.

Two open tabs editing the same manifest at nearly the same time can still race: `writeManifestEntry` does a
full overwrite with no locking, same as when two terminals ran `set-status` concurrently before this feature.
This risk isn't new, so it isn't solved here.

A document's "view original at this commit" link comes from that document's own manifest entry (`source_repo`,
`source_commit`), not from static config. Static config only holds the license name and its URL. A static
original-work name or URL in config could drift from the truth. A value read from the manifest cannot drift.
Every build reads the current manifest.
