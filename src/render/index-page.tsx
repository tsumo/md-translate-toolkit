/** The index page: one card per claimed document, under the slim sticky header. */
import { readFileSync } from "node:fs";
import { hrefForDoc } from "../paths.js";
import { translationProgress } from "../split-blocks.js";
import { deriveFileStatus } from "../status.js";
import type { ManifestEntry, TranslationStatus } from "../types.js";
import { type Attribution, Footer } from "./document.js";
import { type PageOptions, pageWrapper, SiteHeader } from "./page.js";

/** The statuses a card's progress bar draws, left to right. */
const BAR_STATUSES: TranslationStatus[] = ["verified", "complete", "needs-attention", "in-progress"];

/** The translated and total block counts of one document. */
type Progress = { translated: number; total: number };

interface IndexCardProps {
  entry: ManifestEntry;
  progress: Progress;
}

/** The blocks a card counts: the manifest blocks minus thematic breaks, which hold no text and are
 * skipped by `translationProgress` too. */
function countingBlocks(entry: Pick<ManifestEntry, "blocks">): ManifestEntry["blocks"] {
  return entry.blocks.filter((block) => block.kind !== "thematicBreak");
}

/** The segments of a card's progress bar: one per status, in draw order. A document with nothing
 * translated yet draws one not-started segment, like the chip. */
function barSegments(counting: ManifestEntry["blocks"], progress: Progress): { status: TranslationStatus; count: number }[] {
  if (progress.translated === 0) return counting.length > 0 ? [{ status: "not-started", count: counting.length }] : [];
  return BAR_STATUSES.map((status) => ({ status, count: counting.filter((b) => b.status === status).length })).filter(
    (segment) => segment.count > 0,
  );
}

/** The caption under the bar: the translated count, plus the needs-attention count, or an invitation to
 * start when nothing is translated and nothing needs attention. */
function cardCaption(progress: Progress, needsAttention: number): string {
  const blocks = `block${progress.total === 1 ? "" : "s"}`;
  const base = `${progress.translated} of ${progress.total} ${blocks} translated`;
  if (needsAttention > 0) return `${base} · ${needsAttention} needs-attention`;
  if (progress.translated === 0) return `${base} — open the document to begin`;
  return base;
}

/** One card: title link, status chip, segmented bar, counts caption, repository metadata. */
function IndexCard({ entry, progress }: IndexCardProps) {
  const status = deriveFileStatus(entry.blocks, progress);
  const counting = countingBlocks(entry);
  const needsAttention = counting.filter((block) => block.status === "needs-attention").length;
  return (
    <li>
      <a class="index-card" href={hrefForDoc(entry.original_path)}>
        <div class="card-head">
          <h2 class="card-title">{entry.original_path}</h2>
          <span class={`chip status-${status}`}>{status}</span>
        </div>
        <div class="bar">
          {barSegments(counting, progress).map((segment) => (
            <span class={`bar-seg status-${segment.status}`} style={`flex-grow:${segment.count}`} />
          ))}
        </div>
        <p class="card-caption">{cardCaption(progress, needsAttention)}</p>
        <p class="card-meta">
          {entry.source_repo} · pinned {entry.source_commit.slice(0, 7)} · synced {entry.last_synced}
        </p>
      </a>
    </li>
  );
}

export function renderIndexCard(entry: ManifestEntry, progress: Progress): string {
  return String(<IndexCard entry={entry} progress={progress} />);
}

/** The header summary: document, translated-block, and needs-attention counts across all documents. */
export function indexSummary(entries: Pick<ManifestEntry, "blocks">[], progresses: Progress[]): string {
  const total = progresses.reduce((sum, progress) => sum + progress.total, 0);
  const translated = progresses.reduce((sum, progress) => sum + progress.translated, 0);
  const needsAttention = entries.reduce(
    (sum, entry) => sum + countingBlocks(entry).filter((block) => block.status === "needs-attention").length,
    0,
  );
  return (
    `${entries.length} document${entries.length === 1 ? "" : "s"} · ` +
    `${translated} of ${total} block${total === 1 ? "" : "s"} · ` +
    `${needsAttention} needs-attention`
  );
}

/** The rendered header, for the render tests: they are plain `.ts` files, where JSX does not parse. */
export function renderIndexHeader(summary: string): string {
  return String(<SiteHeader right={summary} />);
}

export function renderIndexPage(entries: ManifestEntry[], attribution: Attribution, options: PageOptions): string {
  const progresses = entries.map((entry) => translationProgress(readFileSync(entry.translation_path, "utf-8")));
  const body = (
    <>
      <SiteHeader right={indexSummary(entries, progresses)} />
      <main>
        <h1>Claimed documents</h1>
        <p class="lede">Everything you have claimed from upstream, and where each translation stands.</p>
        <ul class="index">
          {entries.map((entry, i) => (
            <IndexCard entry={entry} progress={progresses[i]} />
          ))}
        </ul>
      </main>
      <Footer attribution={attribution} note="originals pinned to one upstream commit each" />
    </>
  );
  return pageWrapper("Translations", String(body), options);
}
