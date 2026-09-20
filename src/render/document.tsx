/** The document page: the three-column body, the status pills, and the footer. */
import { raw } from "hono/html";
import type { RootContent } from "mdast";
import type { ResolvedConfig } from "../config.js";
import {
  ANCHOR_PREFIX,
  ATTR_BLOCK,
  ATTR_COMMENT,
  ATTR_ORIGINAL_PATH,
  ATTR_STATUS,
  ATTR_STATUSES,
  PILL_CLASS,
} from "../dom-names.js";
import { encodePathSegments } from "../paths.js";
import { isUntranslated } from "../split-blocks.js";
import { VALID_BLOCK_STATUSES } from "../status.js";
import type { BlockEntry, ManifestEntry } from "../types.js";
import { documentToBlockHtml } from "./blocks.js";
import { type PageOptions, pageWrapper } from "./page.js";

export type Attribution = Pick<ResolvedConfig, "licenseName" | "licenseUrl">;

/** A GitHub link to `path` in `repo` at `commit`. */
function githubBlobUrl(repo: string, commit: string, path: string): string {
  return `https://github.com/${repo}/blob/${commit}/${encodePathSegments(path)}`;
}

export function Footer({ attribution, entry }: { attribution: Attribution; entry?: ManifestEntry }) {
  const parts = [];

  if (entry) {
    parts.push(
      <>
        Translated from <a href={`https://github.com/${entry.source_repo}`}>{entry.source_repo}</a> (
        <a href={githubBlobUrl(entry.source_repo, entry.source_commit, entry.original_path)}>
          view original at this commit
        </a>
        )
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

  if (parts.length === 0) return null;
  return (
    <footer>
      <p>{parts.flatMap((part, i) => (i === 0 ? [part] : [" — ", part]))}.</p>
    </footer>
  );
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
 * The status pill of one block. It shows the block number, colored by status. A click opens the status
 * dialog, which the client builds. Only the dev server shows it, never the static build (ADR-016).
 */
function StatusPill({ index, block }: { index: number; block: BlockEntry }) {
  const title = pillTitle(block);
  const data = {
    [ATTR_BLOCK]: index,
    [ATTR_STATUS]: block.status,
    [ATTR_COMMENT]: block.status_comment ?? "",
  };
  return (
    <p class="block-index">
      <button
        type="button"
        class={`${PILL_CLASS} status-${block.status}`}
        {...data}
        style={`anchor-name: ${ANCHOR_PREFIX}${index}`}
        title={title}
        aria-label={`Block ${index}, ${title}`}
      >
        {pillLabel(index, block)}
      </button>
    </p>
  );
}

interface BodyProps {
  backHref: string;
  originalHtml: string[];
  translationHtml: string[];
  translationNodes: RootContent[];
  editable?: { originalPath: string; blocks: BlockEntry[] };
}

function DocumentBody({ backHref, originalHtml, translationHtml, translationNodes, editable }: BodyProps) {
  const rowCount = Math.max(originalHtml.length, translationHtml.length);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const node = translationNodes[i];
    const untranslated = node && isUntranslated(node);
    const block = editable?.blocks[i];
    rows.push(
      <div>
        {block && block.kind !== "thematicBreak" ? (
          <StatusPill index={i} block={block} />
        ) : (
          <p class="block-index">{i}</p>
        )}
      </div>,
      <div>{raw(originalHtml[i] ?? "")}</div>,
      <div class={untranslated ? "untranslated" : undefined}>{raw(translationHtml[i] ?? "")}</div>,
    );
  }
  const columnsData = editable
    ? { [ATTR_ORIGINAL_PATH]: editable.originalPath, [ATTR_STATUSES]: VALID_BLOCK_STATUSES.join(" ") }
    : {};
  return (
    <>
      <p>
        <a href={backHref}>{raw("&larr; all documents")}</a>
      </p>
      <div class="columns" {...columnsData}>
        {rows}
      </div>
    </>
  );
}

/**
 * The body of a document page, with three columns: index, original, translation. The index column shows the
 * block number that `set-status --block` takes. In the dev server, the number is also the status button.
 * `backHref` links back to the index. It is `/` for the dev server and a relative path for the static build.
 */
export function renderDocumentBody(
  backHref: string,
  originalHtml: string[],
  translationHtml: string[],
  translationNodes: RootContent[],
  editable?: { originalPath: string; blocks: BlockEntry[] },
): string {
  return String(
    <DocumentBody
      backHref={backHref}
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
  const body = renderDocumentBody(backHref, originalHtml, translationHtml, translationNodes, editableInfo);
  return pageWrapper(entry.original_path, body + String(<Footer attribution={attribution} entry={entry} />), options);
}
