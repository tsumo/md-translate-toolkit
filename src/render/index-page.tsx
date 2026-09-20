/** The index page: one entry per claimed document. */
import { readFileSync } from "node:fs";
import { hrefForDoc } from "../paths.js";
import { translationProgress } from "../split-blocks.js";
import { deriveFileStatus } from "../status.js";
import type { ManifestEntry } from "../types.js";
import { type Attribution, Footer } from "./document.js";
import { type PageOptions, pageWrapper } from "./page.js";

interface IndexItemProps {
  entry: ManifestEntry;
  progress: { translated: number; total: number };
  stale: boolean;
}

/** One index entry: link, status badge, progress, and flagged blocks. */
function IndexItem({ entry, progress, stale }: IndexItemProps) {
  const status = deriveFileStatus(entry.blocks, progress);
  const flagged = entry.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.status === "needs-attention");

  return (
    <li>
      <a href={hrefForDoc(entry.original_path)}>{entry.original_path}</a>{" "}
      <span class={`badge status-${status}`}>{status}</span>{" "}
      {stale && (
        <>
          <span class="badge status-stale">upstream changed</span>{" "}
        </>
      )}
      <span class="progress">
        {progress.translated}/{progress.total} blocks
      </span>
      {flagged.length > 0 && (
        <>
          {" "}
          <span class="badge status-needs-attention">{flagged.length} flagged</span>
          <ul class="flagged">
            {flagged.map(({ block, index }) => (
              <li>
                block {index}: {block.status_comment ?? ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

export function renderIndexItem(
  entry: ManifestEntry,
  progress: { translated: number; total: number },
  stale = false,
): string {
  return String(<IndexItem entry={entry} progress={progress} stale={stale} />);
}

export function renderIndexPage(
  entries: ManifestEntry[],
  attribution: Attribution,
  options: PageOptions,
  staleness?: Map<string, boolean>,
): string {
  const body = (
    <>
      <h1>Claimed documents</h1>
      <ul class="index">
        {entries.map((entry) => (
          <IndexItem
            entry={entry}
            progress={translationProgress(readFileSync(entry.translation_path, "utf-8"))}
            stale={staleness?.get(entry.original_path) ?? false}
          />
        ))}
      </ul>
      <Footer attribution={attribution} />
    </>
  );
  return pageWrapper("Translations", String(body), options);
}
