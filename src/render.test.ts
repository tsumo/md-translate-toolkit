import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBlocks } from "./parse-blocks.js";
import { documentToBlockHtml } from "./render/blocks.js";
import { renderDocumentBody, renderDocumentHeader } from "./render/document.js";
import { indexSummary, renderIndexCard, renderIndexHeader } from "./render/index-page.js";
import { barSegments, documentCaption, progressOf } from "./render/progress.js";
import type { ManifestEntry } from "./types.js";

function normalizeHtml(html: string): string {
  return html.replace(/>\s+</g, "><").trim();
}

function assertOrder(html: string, ...substrings: string[]): void {
  let at = 0;
  for (const substring of substrings) {
    const next = html.indexOf(substring, at);
    assert.ok(next !== -1, `expected ${JSON.stringify(substring)} at or after index ${at}`);
    at = next + substring.length;
  }
}

describe("documentToBlockHtml", () => {
  it("returns exactly one HTML string per block, with no extra empty entries", () => {
    const nodes = parseBlocks("# Heading\n\nA paragraph.\n\nAnother paragraph.");
    assert.deepEqual(documentToBlockHtml(nodes).map(normalizeHtml), [
      '<h1 id="heading">Heading</h1>',
      "<p>A paragraph.</p>",
      "<p>Another paragraph.</p>",
    ]);
  });

  it("keeps a raw <br> tag instead of stripping it", () => {
    const nodes = parseBlocks("Line one.<br>\nLine two.");
    assert.deepEqual(documentToBlockHtml(nodes).map(normalizeHtml), ["<p>Line one.<br>\nLine two.</p>"]);
  });

  it("gives every heading an id, de-duplicated across the whole document", () => {
    const nodes = parseBlocks("# Same Title\n\n# Same Title");
    assert.deepEqual(documentToBlockHtml(nodes).map(normalizeHtml), [
      '<h1 id="same-title">Same Title</h1>',
      '<h1 id="same-title-1">Same Title</h1>',
    ]);
  });
});

describe("renderDocumentHeader", () => {
  const blocks = [
    { kind: "paragraph" as const, fingerprint: "0000000000000000", status: "verified" as const },
    { kind: "paragraph" as const, fingerprint: "1111111111111111", status: "complete" as const },
    { kind: "paragraph" as const, fingerprint: "2222222222222222", status: "needs-attention" as const },
    { kind: "paragraph" as const, fingerprint: "3333333333333333", status: "in-progress" as const },
  ];

  it("joins the back link and the file name in one breadcrumb whose slash and name sit outside the link", () => {
    const header = renderDocumentHeader("/", { original_path: "Example.md", blocks }, { translated: 3, total: 4 });
    assert.match(header, /<header class="site-header doc-header">/);
    assert.match(
      header,
      /<p class="breadcrumb"><a href="\/">← Translations<\/a> \/ <span class="crumb-file">Example\.md<\/span><\/p>/,
    );
    // The slash and the file name are plain text; no second link wraps them.
    assert.equal(header.match(/<a /g)?.length, 1);
  });

  it("escapes a relative backHref, so a literal & in it cannot break out of the href attribute", () => {
    const header = renderDocumentHeader(
      "../a & b/index.html",
      { original_path: "Example.md", blocks: [] },
      { translated: 0, total: 0 },
    );
    assert.match(header, /<a href="\.\.\/a &amp; b\/index\.html">/);
  });

  it("puts the caption with the needs-attention count right before the mini bar", () => {
    const header = renderDocumentHeader("/", { original_path: "Example.md", blocks }, { translated: 3, total: 4 });
    assert.match(header, /<span class="header-caption">3\/4 blocks · 1 needs-attention<\/span>/);
    assertOrder(header, "breadcrumb", "header-caption", '<div class="bar">');
  });

  it("draws the mini bar in status order, one segment per status with blocks present", () => {
    const header = renderDocumentHeader("/", { original_path: "Example.md", blocks }, { translated: 3, total: 4 });
    assert.match(header, /<span class="bar-seg status-verified" style="flex-grow:1"><\/span>/);
    assert.match(header, /<span class="bar-seg status-complete" style="flex-grow:1"><\/span>/);
    assert.match(header, /<span class="bar-seg status-needs-attention" style="flex-grow:1"><\/span>/);
    assert.match(header, /<span class="bar-seg status-in-progress" style="flex-grow:1"><\/span>/);
    assertOrder(header, "status-verified", "status-complete", "status-needs-attention", "status-in-progress");
  });

  it("draws a whole not-started bar while nothing is translated", () => {
    const header = renderDocumentHeader("/", { original_path: "Example.md", blocks }, { translated: 0, total: 4 });
    assert.equal(header.match(/bar-seg/g)?.length, 1);
    assert.match(header, /bar-seg status-not-started/);
  });
});

describe("renderDocumentBody", () => {
  it("labels the two panels, then orders each block row as original cell, rail, translation cell", () => {
    const [n1, n2] = parseBlocks("Переведено.\n\nЕще.");
    const body = renderDocumentBody({
      originalHtml: ["<p>O1</p>", "<p>O2</p>"],
      translationHtml: ["<p>T1</p>", "<p>T2</p>"],
      translationNodes: [n1, n2],
    });
    assertOrder(
      body,
      '<main><div class="doc-grid"><div class="panel-label">Original</div>',
      '<div class="panel-label">Translation</div>',
      '<div class="block-row"><div class="cell orig"><p>O1</p></div>',
      '<div class="rail"><p class="block-index">0</p></div>',
      '<div class="cell"><p>T1</p></div></div>',
      '<div class="block-row"><div class="cell orig"><p>O2</p></div>',
      '<div class="rail"><p class="block-index">1</p></div>',
      '<div class="cell"><p>T2</p></div></div>',
    );
    // One card wrapper per block row, for the phone layout to style.
    assert.equal(body.match(/<div class="block-row">/g)?.length, 2);
    // The grid carries no editable data, e.g. the static build.
    assert.doesNotMatch(body, /data-original-path|data-block/);
  });

  it("marks only the translation side as untranslated, with the tag inside the amber box", () => {
    const [node] = parseBlocks("Original text.");
    const body = renderDocumentBody({
      originalHtml: ["<p>O</p>"],
      translationHtml: ["<p>T</p>"],
      translationNodes: [node],
      blocks: [{ kind: "paragraph", fingerprint: "0000000000000000", status: "untranslated" }],
    });
    assert.match(
      body,
      /<div class="cell untranslated"><div class="untrans-box"><p>T<\/p><p class="untrans-tag">UNTRANSLATED<\/p><\/div><\/div>/,
    );
    assert.match(body, /<div class="cell orig"><p>O<\/p><\/div>/);
  });

  it("embeds rehype block HTML raw, so a <br> inside a paragraph stays a tag", () => {
    const [n1] = parseBlocks("Line one.<br>\nLine two.");
    const body = renderDocumentBody({
      originalHtml: ["<p>Line one.<br>\nLine two.</p>"],
      translationHtml: [],
      translationNodes: [n1],
    });
    assert.match(body, /<p>Line one\.<br>\nLine two\.<\/p>/);
  });

  it("fills a missing side with an empty cell when the two lists differ in length", () => {
    const [n1] = parseBlocks("Переведено.");
    const body = renderDocumentBody({
      originalHtml: ["<p>O1</p>", "<p>O2</p>"],
      translationHtml: ["<p>T1</p>"],
      translationNodes: [n1],
    });
    assertOrder(
      body,
      '<div class="cell"><p>T1</p></div>',
      '<div class="cell orig"><p>O2</p></div>',
      '<div class="rail"><p class="block-index">1</p></div>',
      '<div class="cell"></div>',
    );
  });

  it("renders a display-only status pill per block and the grid data the client needs when editable", () => {
    const [n1, n2] = parseBlocks("Переведено.\n\nЕще.");
    const editable = { originalPath: "reviewed/Simple.md" };
    const blocks = [
      { kind: "paragraph" as const, fingerprint: "0000000000000000", status: "complete" as const },
      { kind: "paragraph" as const, fingerprint: "1111111111111111", status: "verified" as const },
    ];
    const body = renderDocumentBody({
      originalHtml: ["<p>O1</p>", "<p>O2</p>"],
      translationHtml: ["<p>T1</p>", "<p>T2</p>"],
      translationNodes: [n1, n2],
      editable,
      blocks,
    });
    assert.match(body, /<span class="status-pill status-complete" data-block="0" data-status="complete"/);
    assert.match(body, /<span class="status-pill status-verified" data-block="1"/);
    assert.match(
      body,
      /<div class="doc-grid" data-original-path="reviewed\/Simple\.md" data-statuses="untranslated in-progress complete verified needs-attention">/,
    );
    // Pills are display-only: no clickable element and no editing markup in the server HTML.
    assert.doesNotMatch(body, /<button|<dialog|<form|<script/);
  });

  it("marks a needs-attention pill with ! and puts the comment in its title", () => {
    const [n1] = parseBlocks("Переведено.");
    const blocks = [
      {
        kind: "paragraph" as const,
        fingerprint: "0000000000000000",
        status: "needs-attention" as const,
        status_comment: "check this",
      },
    ];
    const body = renderDocumentBody({
      originalHtml: ["<p>O1</p>"],
      translationHtml: ["<p>T1</p>"],
      translationNodes: [n1],
      editable: { originalPath: "reviewed/Simple.md" },
      blocks,
    });
    assert.match(body, /title="needs-attention: check this"[^>]*>0!<\/span>/);
  });

  it("renders a flagged block as a tinted box with the comment as a red note below it", () => {
    const [n1] = parseBlocks("Переведено.");
    const blocks = [
      {
        kind: "paragraph" as const,
        fingerprint: "0000000000000000",
        status: "needs-attention" as const,
        status_comment: "check this",
      },
    ];
    const body = renderDocumentBody({
      originalHtml: ["<p>O1</p>"],
      translationHtml: ["<p>T1</p>"],
      translationNodes: [n1],
      editable: { originalPath: "reviewed/Simple.md" },
      blocks,
    });
    assert.match(
      body,
      /<div class="cell flagged block-cell" data-block="0"><div class="flag-box"><p>T1<\/p><\/div><p class="flag-note">Needs attention — check this<\/p><\/div>/,
    );
    // The original side carries no tint and no note.
    assert.doesNotMatch(body, /cell orig flagged|flag-note.*O1/);
    assertOrder(body, "flag-box", "flag-note");
  });

  it("renders an editable untranslated block as an amber box openable in the editor, with the tag inside", () => {
    const [node] = parseBlocks("- a list item");
    const blocks = [{ kind: "list" as const, fingerprint: "0000000000000000", status: "untranslated" as const }];
    const body = renderDocumentBody({
      originalHtml: ["<p>O</p>"],
      translationHtml: ["<ul><li>T</li></ul>"],
      translationNodes: [node],
      editable: { originalPath: "reviewed/Simple.md" },
      blocks,
    });
    assert.match(body, /<div class="cell untranslated block-cell" data-block="0"><div class="untrans-box">/);
    assertOrder(body, "<ul>", "untrans-tag");
  });

  it("does not mark a block untranslated from its text alone: only the status does", () => {
    // The placeholder text is a bare preview, indistinguishable from content. Without the
    // manifest's blocks, e.g. in an old call site, no untranslated styling appears.
    const [node] = parseBlocks("Original text.");
    const body = renderDocumentBody({
      originalHtml: ["<p>O</p>"],
      translationHtml: ["<p>T</p>"],
      translationNodes: [node],
    });
    assert.doesNotMatch(body, /untranslated|untrans-tag/);
  });

  it("renders a centered status pill, colored by its toolkit-owned status, for a thematic-break row", () => {
    const [n1] = parseBlocks("---");
    const blocks = [{ kind: "thematicBreak" as const, fingerprint: "0000000000000000", status: "verified" as const }];
    const body = renderDocumentBody({
      originalHtml: ["<hr>"],
      translationHtml: ["<hr>"],
      translationNodes: [n1],
      editable: { originalPath: "reviewed/Simple.md" },
      blocks,
    });
    assert.match(body, /<div class="block-row block-row-divider"><div class="cell orig divider-row"><hr><\/div>/);
    assert.match(body, /<div class="rail rail-divider"><span class="status-pill status-verified"/);
    assert.match(body, /<div class="cell divider-row"><hr><\/div>/);
    // The pill informs, but the editor never opens for a divider.
    assert.doesNotMatch(body, /block-cell|class="untranslated|untrans-box/);
  });

  it("renders a plain centered number for a thematic-break row with no manifest entry", () => {
    const [n1] = parseBlocks("---");
    const body = renderDocumentBody({ originalHtml: ["<hr>"], translationHtml: ["<hr>"], translationNodes: [n1] });
    assert.match(body, /<div class="rail rail-divider"><p class="block-index">0<\/p><\/div>/);
    assert.doesNotMatch(body, /status-pill/);
  });

  it("renders no pill and no editing markup when editable info is omitted, e.g. the static build", () => {
    const [n1] = parseBlocks("Переведено.");
    const body = renderDocumentBody({
      originalHtml: ["<p>O1</p>"],
      translationHtml: ["<p>T1</p>"],
      translationNodes: [n1],
    });
    assert.doesNotMatch(body, /status-pill/);
    assert.doesNotMatch(body, /<dialog|<form|<script/);
  });

  it("escapes & and quotes in a status_comment placed in an attribute", () => {
    const [n1] = parseBlocks("Переведено.");
    const blocks = [
      {
        kind: "paragraph" as const,
        fingerprint: "0000000000000000",
        status: "needs-attention" as const,
        status_comment: 'check "this" & that',
      },
    ];
    const body = renderDocumentBody({
      originalHtml: ["<p>O1</p>"],
      translationHtml: ["<p>T1</p>"],
      translationNodes: [n1],
      editable: { originalPath: "reviewed/Simple.md" },
      blocks,
    });
    assert.match(body, /data-comment="check &quot;this&quot; &amp; that"/);
  });

  it("renders an html row as muted source in the dev server, still openable in the editor", () => {
    const [orig] = parseBlocks('<!-- p. 13 --><a id="page-13"></a>');
    const blocks = [{ kind: "html" as const, fingerprint: "0000000000000000", status: "verified" as const }];
    const source = '<!-- p. 13 --><a id="page-13"></a>';
    const body = renderDocumentBody({
      originalHtml: [source],
      translationHtml: [source],
      translationNodes: [orig],
      editable: { originalPath: "reviewed/Simple.md" },
      originalNodes: [orig],
      blocks,
    });
    assert.match(body, /data-block="0"/);
    // The markup is escaped text, never rendered raw, so the row is never a blank mystery.
    assert.doesNotMatch(body, /<a id="page-13"><\/a>/);
    assert.match(body, /&lt;a id=/);
  });

  it("renders an html row as real markup in the static build, with no muted source", () => {
    const [orig] = parseBlocks('<!-- p. 13 --><a id="page-13"></a>');
    const source = '<!-- p. 13 --><a id="page-13"></a>';
    const body = renderDocumentBody({
      originalHtml: [source],
      translationHtml: [source],
      translationNodes: [orig],
      originalNodes: [orig],
    });
    assert.match(body, /<a id="page-13"><\/a>/);
    assert.doesNotMatch(body, /html-source/);
  });

  it("shows an untranslated html placeholder as muted source inside the untranslated box", () => {
    const [node] = parseBlocks("<div>Some text</div>");
    const blocks = [{ kind: "html" as const, fingerprint: "0000000000000000", status: "untranslated" as const }];
    const body = renderDocumentBody({
      originalHtml: ["<div>O</div>"],
      translationHtml: ["<div>T</div>"],
      translationNodes: [node],
      editable: { originalPath: "reviewed/Simple.md" },
      originalNodes: [node],
      blocks,
    });
    assertOrder(body, "untrans-box", "html-source", "untrans-tag");
  });
});

describe("renderIndexCard", () => {
  function entry(overrides: Partial<ManifestEntry>): ManifestEntry {
    return {
      original_path: "reviewed/Simple.md",
      source_repo: "user/Source-Repo",
      source_commit: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
      source_sha256: "deadbeef",
      translation_path: "translations/reviewed/Simple.md",
      last_synced: "2026-01-01",
      blocks: [],
      ...overrides,
    };
  }

  it("renders title link, status chip, segmented bar, counts caption, and meta for a verified document", () => {
    const doc = entry({
      blocks: [
        { kind: "paragraph", fingerprint: "1111111111111111", status: "verified" },
        { kind: "paragraph", fingerprint: "2222222222222222", status: "verified" },
      ],
    });
    const html = renderIndexCard(doc, { translated: 2, total: 2 });
    assert.match(html, /<a class="index-card" href="doc\/reviewed\/Simple\.md\.html">/);
    assert.match(html, /<h2 class="card-title">reviewed\/Simple\.md<\/h2>/);
    assert.match(html, /<span class="chip status-verified">verified<\/span>/);
    assert.match(html, /<span class="bar-seg status-verified" style="flex-grow:2"><\/span>/);
    assert.match(html, /<p class="card-caption">2 of 2 blocks translated<\/p>/);
    assert.match(html, /<p class="card-meta">user\/Source-Repo · pinned e5f6a7b · synced 2026-01-01<\/p>/);
    assertOrder(html, "card-title", "chip status-verified", '<div class="bar">', "card-caption", "card-meta");
  });

  it("summarizes needs-attention in the caption and groups bar segments by status", () => {
    const doc = entry({
      blocks: [
        { kind: "paragraph", fingerprint: "1111111111111111", status: "complete" },
        {
          kind: "paragraph",
          fingerprint: "2222222222222222",
          status: "needs-attention",
          status_comment: "Check this <b>tag</b>",
        },
        { kind: "paragraph", fingerprint: "3333333333333333", status: "in-progress" },
        { kind: "thematicBreak", fingerprint: "4444444444444444", status: "needs-attention" },
      ],
    });
    const html = renderIndexCard(doc, { translated: 1, total: 3 });
    assert.match(html, /<span class="chip status-needs-attention">needs-attention<\/span>/);
    assert.match(html, /<span class="bar-seg status-complete" style="flex-grow:1"><\/span>/);
    assert.match(html, /<span class="bar-seg status-needs-attention" style="flex-grow:1"><\/span>/);
    assert.match(html, /<span class="bar-seg status-in-progress" style="flex-grow:1"><\/span>/);
    // Draw order: verified, complete, needs-attention, in-progress.
    assertOrder(html, "bar-seg status-complete", "bar-seg status-needs-attention", "bar-seg status-in-progress");
    assert.match(html, /<p class="card-caption">1 of 3 blocks translated · 1 needs-attention<\/p>/);
    // The divider is needs-attention too, but dividers sit outside every count, so no segment
    // absorbs it into flex-grow:2.
    assert.doesNotMatch(html, /flex-grow:2/);
    // The per-block comment list is gone; the caption count is the only summary.
    assert.doesNotMatch(html, /flagged|status_comment|Check this/);
  });

  it("draws a whole not-started bar and the open-the-document caption when nothing is claimed", () => {
    const doc = entry({
      blocks: [
        { kind: "paragraph", fingerprint: "1111111111111111", status: "untranslated" },
        { kind: "paragraph", fingerprint: "2222222222222222", status: "untranslated" },
      ],
    });
    const html = renderIndexCard(doc, { translated: 0, total: 2 });
    assert.match(html, /<span class="chip status-not-started">not-started<\/span>/);
    // With nothing claimed the whole bar is one segment.
    assert.match(html, /<span class="bar-seg status-not-started" style="flex-grow:2"><\/span>/);
    assert.equal(html.match(/bar-seg/g)?.length, 1);
    assert.match(html, /<p class="card-caption">0 of 2 blocks translated — open the document to begin<\/p>/);
  });

  it("excludes thematic-break blocks from the bar segments, as the progress count does", () => {
    const doc = entry({
      blocks: [
        { kind: "paragraph", fingerprint: "1111111111111111", status: "verified" },
        { kind: "thematicBreak", fingerprint: "2222222222222222", status: "verified" },
      ],
    });
    const html = renderIndexCard(doc, { translated: 1, total: 1 });
    assert.equal(html.match(/bar-seg/g)?.length, 1);
    assert.match(html, /<span class="bar-seg status-verified" style="flex-grow:1"><\/span>/);
  });

  it("HTML-escapes the & in the href and the file title, and lets needs-attention win the caption", () => {
    const doc = entry({
      original_path: "reviewed/Some & File.md",
      blocks: [
        {
          kind: "paragraph",
          fingerprint: "1111111111111111",
          status: "needs-attention",
          status_comment: "Check this",
        },
      ],
    });
    const html = renderIndexCard(doc, { translated: 0, total: 0 });
    assert.match(html, /href="doc\/reviewed\/Some%20&amp;%20File\.md\.html"/);
    assert.match(html, /<h2 class="card-title">reviewed\/Some &amp; File\.md<\/h2>/);
    // Nothing is translated, so the bar is one not-started segment; chip and caption carry the signal.
    assert.match(html, /<span class="chip status-needs-attention">needs-attention<\/span>/);
    assert.match(html, /bar-seg status-not-started/);
    assert.match(html, /0 of 0 blocks translated · 1 needs-attention/);
    assert.doesNotMatch(html, /open the document/);
  });
});

describe("progressOf", () => {
  it("counts blocks claimed complete or verified, and excludes dividers from the total", () => {
    const entry = {
      blocks: [
        { kind: "paragraph" as const, fingerprint: "1", status: "complete" as const },
        { kind: "paragraph" as const, fingerprint: "2", status: "verified" as const },
        { kind: "paragraph" as const, fingerprint: "3", status: "untranslated" as const },
        { kind: "html" as const, fingerprint: "4", status: "untranslated" as const },
        { kind: "thematicBreak" as const, fingerprint: "5", status: "verified" as const },
      ],
    };
    assert.deepEqual(progressOf(entry), { translated: 2, total: 4 });
  });

  it("does not count needs-attention blocks as translated", () => {
    const entry = {
      blocks: [
        { kind: "paragraph" as const, fingerprint: "1", status: "needs-attention" as const },
        { kind: "paragraph" as const, fingerprint: "2", status: "complete" as const },
      ],
    };
    assert.deepEqual(progressOf(entry), { translated: 1, total: 2 });
  });
});

describe("barSegments", () => {
  it("draws one not-started segment while nothing is claimed", () => {
    const counting = [
      { kind: "paragraph" as const, fingerprint: "1", status: "untranslated" as const },
      { kind: "paragraph" as const, fingerprint: "2", status: "untranslated" as const },
    ];
    assert.deepEqual(barSegments(counting, { translated: 0, total: 2 }), [{ status: "not-started", count: 2 }]);
  });

  it("draws one segment per present status, untranslated first", () => {
    const counting = [
      { kind: "paragraph" as const, fingerprint: "1", status: "untranslated" as const },
      { kind: "paragraph" as const, fingerprint: "2", status: "complete" as const },
      { kind: "paragraph" as const, fingerprint: "3", status: "verified" as const },
    ];
    assert.deepEqual(barSegments(counting, { translated: 2, total: 3 }), [
      { status: "untranslated", count: 1 },
      { status: "verified", count: 1 },
      { status: "complete", count: 1 },
    ]);
  });
});

describe("documentCaption", () => {
  it("reads translated/total blocks, plus the needs-attention count when there is one", () => {
    assert.equal(documentCaption({ translated: 5, total: 6 }, 1), "5/6 blocks · 1 needs-attention");
    assert.equal(documentCaption({ translated: 6, total: 6 }, 0), "6/6 blocks");
  });

  it("uses the singular for one block", () => {
    assert.equal(documentCaption({ translated: 1, total: 1 }, 0), "1/1 block");
  });
});

describe("indexSummary", () => {
  it("counts documents, translated blocks, and needs-attention blocks across all entries", () => {
    const entries = [
      {
        blocks: [
          { kind: "paragraph", fingerprint: "1111111111111111", status: "verified" as const },
          { kind: "paragraph", fingerprint: "2222222222222222", status: "needs-attention" as const },
        ],
      },
      { blocks: [] },
    ];
    assert.equal(
      indexSummary(entries, [
        { translated: 5, total: 8 },
        { translated: 0, total: 0 },
      ]),
      "2 documents · 5 of 8 blocks · 1 needs-attention",
    );
  });

  it("uses the singular for one document and one block", () => {
    const entries = [{ blocks: [{ kind: "paragraph", fingerprint: "1111111111111111", status: "verified" as const }] }];
    assert.equal(indexSummary(entries, [{ translated: 1, total: 1 }]), "1 document · 1 of 1 block · 0 needs-attention");
  });

  it("excludes thematic-break blocks from the needs-attention count, as the progress count does", () => {
    const entries = [
      {
        blocks: [
          { kind: "paragraph", fingerprint: "1111111111111111", status: "verified" as const },
          { kind: "thematicBreak", fingerprint: "2222222222222222", status: "needs-attention" as const },
        ],
      },
    ];
    assert.equal(indexSummary(entries, [{ translated: 1, total: 1 }]), "1 document · 1 of 1 block · 0 needs-attention");
  });
});

describe("renderIndexHeader", () => {
  it("renders the wordmark and the page summary in one header", () => {
    const html = renderIndexHeader("2 documents · 5 of 8 blocks · 1 needs-attention");
    assert.match(html, /<header class="site-header">/);
    assert.match(html, /<span class="wordmark">md-translate<\/span>/);
    assert.match(html, /<span class="header-summary">2 documents · 5 of 8 blocks · 1 needs-attention<\/span>/);
    assertOrder(html, "wordmark", "header-summary");
  });
});
