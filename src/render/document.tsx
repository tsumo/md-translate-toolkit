/** The document page: the sticky breadcrumb header with the mini progress bar, the two panels and the
 * pill rail in one co-scrolling grid, and the footer. */
import { raw } from "hono/html";
import type { RootContent } from "mdast";
import type { ResolvedConfig } from "../config.js";
import {
  ATTR_BLOCK,
  ATTR_COMMENT,
  ATTR_ORIGINAL_PATH,
  ATTR_STATUS,
  ATTR_STATUSES,
  CELL_CLASS,
  PILL_CLASS,
} from "../dom-names.js";
import { encodePathSegments } from "../paths.js";
import { isUntranslated } from "../placeholder.js";
import { progressFromNodes } from "../split-blocks.js";
import { VALID_BLOCK_STATUSES } from "../status.js";
import type { BlockEntry, ManifestEntry } from "../types.js";
import { documentToBlockHtml } from "./blocks.js";
import { type PageOptions, pageWrapper } from "./page.js";
import { barSegments, countingBlocks, documentCaption, needsAttentionCount, type Progress } from "./progress.js";

export type Attribution = Pick<ResolvedConfig, "licenseName" | "licenseUrl">;

/** A GitHub link to `path` in `repo` at `commit`. */
function githubBlobUrl(repo: string, commit: string, path: string): string {
  return `https://github.com/${repo}/blob/${commit}/${encodePathSegments(path)}`;
}

export function Footer({
  attribution,
  entry,
  note,
}: {
  attribution: Attribution;
  entry?: ManifestEntry;
  note?: string;
}) {
  const parts = [];

  if (entry) {
    parts.push(
      <>
        Translated from <a href={`https://github.com/${entry.source_repo}`}>{entry.source_repo}</a>
        {" · "}
        <a href={githubBlobUrl(entry.source_repo, entry.source_commit, entry.original_path)}>
          view original at commit {entry.source_commit.slice(0, 7)}
        </a>
      </>,
    );
  }

  if (attribution.licenseName && attribution.licenseUrl) {
    parts.push(
      <>
        Licensed under <a href={attribution.licenseUrl}>{attribution.licenseName}</a>
      </>,
    );
  }

  if (note) parts.push(note);

  if (parts.length === 0) return null;
  return (
    <footer>
      <p>{parts.flatMap((part, i) => (i === 0 ? [part] : [" · ", part]))}</p>
    </footer>
  );
}

/**
 * The sticky header: the breadcrumb back to the index on the left; the progress caption hugging the mini
 * bar on the right. The slash and the file name are plain text, not part of the link.
 */
function DocumentHeader({
  backHref,
  entry,
  progress,
}: {
  backHref: string;
  entry: Pick<ManifestEntry, "original_path" | "blocks">;
  progress: Progress;
}) {
  const counting = countingBlocks(entry);
  return (
    <header class="site-header doc-header">
      <p class="breadcrumb">
        <a href={backHref}>← Translations</a> / <span class="crumb-file">{entry.original_path}</span>
      </p>
      <div class="header-progress">
        <span class="header-caption">{documentCaption(progress, needsAttentionCount(counting))}</span>
        <div class="bar">
          {barSegments(counting, progress).map((segment) => (
            <span class={`bar-seg status-${segment.status}`} style={`flex-grow:${segment.count}`} />
          ))}
        </div>
      </div>
    </header>
  );
}

/** The rendered header, for the render tests: they are plain `.ts` files, where JSX does not parse. */
export function renderDocumentHeader(
  backHref: string,
  entry: Pick<ManifestEntry, "original_path" | "blocks">,
  progress: Progress,
): string {
  return String(<DocumentHeader backHref={backHref} entry={entry} progress={progress} />);
}

/** The label of a status pill. It is the block number, and a flagged block also gets a "!". */
function pillLabel(index: number, block: BlockEntry): string {
  return block.status === "needs-attention" ? `${index}!` : String(index);
}

/** The hover text of a status pill: the status, and the comment if there is one. */
function pillTitle(block: BlockEntry): string {
  return block.status_comment ? `${block.status}: ${block.status_comment}` : block.status;
}

/**
 * The display-only status pill of one block: the block number, colored by status.
 * Carries the status and comment for the inline editor to prefill from.
 */
function StatusPill({ index, block }: { index: number; block: BlockEntry }) {
  const title = pillTitle(block);
  const data = {
    [ATTR_BLOCK]: index,
    [ATTR_STATUS]: block.status,
    [ATTR_COMMENT]: block.status_comment ?? "",
  };
  return (
    <span
      class={`${PILL_CLASS} status-${block.status}`}
      {...data}
      title={title}
      role="img"
      aria-label={`Block ${index}, ${title}`}
    >
      {pillLabel(index, block)}
    </span>
  );
}

function RailCell({ index, block, divider }: { index: number; block?: BlockEntry; divider: boolean }) {
  if (block && !divider)
    return (
      <div class="rail">
        <StatusPill index={index} block={block} />
      </div>
    );
  return (
    <div class={divider ? "rail rail-divider" : "rail"}>
      <p class="block-index">{index}</p>
    </div>
  );
}

function TranslationCell({
  index,
  html,
  node,
  block,
  editable,
}: {
  index: number;
  html: string;
  node?: RootContent;
  block?: BlockEntry;
  editable: boolean;
}) {
  const divider = node?.type === "thematicBreak";
  const flagged = !divider && block?.status === "needs-attention";
  const untranslated = !divider && !flagged && node !== undefined && isUntranslated(node);
  const openable = Boolean(editable && block && !divider);
  const className = [
    "cell",
    divider ? "divider-row" : "",
    untranslated ? "untranslated" : "",
    flagged ? "flagged" : "",
    openable ? CELL_CLASS : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div class={className || undefined} data-block={openable ? index : undefined}>
      {flagged ? (
        <>
          <div class="flag-box">{raw(html)}</div>
          {block?.status_comment ? <p class="flag-note">Needs attention — {block.status_comment}</p> : null}
        </>
      ) : untranslated ? (
        <div class="untrans-box">
          {raw(html)}
          <p class="untrans-tag">UNTRANSLATED</p>
        </div>
      ) : (
        raw(html)
      )}
    </div>
  );
}

interface BodyProps {
  originalHtml: string[];
  translationHtml: string[];
  translationNodes: RootContent[];
  editable?: { originalPath: string; blocks: BlockEntry[] };
}

/** One row per block: the original cell, the rail, and the translation cell. The grid keeps the two
 * panels co-scrolling, so a block pair never loses alignment. */
function DocumentBody({ originalHtml, translationHtml, translationNodes, editable }: BodyProps) {
  const rowCount = Math.max(originalHtml.length, translationHtml.length);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const node = translationNodes[i];
    const block = editable?.blocks[i];
    const divider = node?.type === "thematicBreak";
    rows.push(
      <div class={divider ? "cell orig divider-row" : "cell orig"}>{raw(originalHtml[i] ?? "")}</div>,
      <RailCell index={i} block={block} divider={divider} />,
      <TranslationCell
        index={i}
        html={translationHtml[i] ?? ""}
        node={node}
        block={block}
        editable={Boolean(editable)}
      />,
    );
  }
  const containerData = editable
    ? {
        [ATTR_ORIGINAL_PATH]: editable.originalPath,
        [ATTR_STATUSES]: VALID_BLOCK_STATUSES.join(" "),
      }
    : {};
  return (
    <main>
      <div class="doc-grid" {...containerData}>
        <div class="panel-label">Original</div>
        <div class="rail" />
        <div class="panel-label">Translation</div>
        {rows}
      </div>
    </main>
  );
}

export function renderDocumentBody(
  originalHtml: string[],
  translationHtml: string[],
  translationNodes: RootContent[],
  editable?: { originalPath: string; blocks: BlockEntry[] },
): string {
  return String(
    <DocumentBody
      originalHtml={originalHtml}
      translationHtml={translationHtml}
      translationNodes={translationNodes}
      editable={editable}
    />,
  );
}

export function renderDocumentPage(
  entry: ManifestEntry,
  originalHtml: string[],
  translationNodes: RootContent[],
  backHref: string,
  attribution: Attribution,
  options: PageOptions,
  editable = false,
): string {
  const translationHtml = documentToBlockHtml(translationNodes);
  const editableInfo = editable ? { originalPath: entry.original_path, blocks: entry.blocks } : undefined;
  const body = renderDocumentBody(originalHtml, translationHtml, translationNodes, editableInfo);
  const header = renderDocumentHeader(backHref, entry, progressFromNodes(translationNodes));
  return pageWrapper(
    entry.original_path,
    header + body + String(<Footer attribution={attribution} entry={entry} />),
    options,
  );
}
