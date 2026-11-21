import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBlocks } from "./parse-blocks.js";
import { documentToBlockHtml } from "./render/blocks.js";
import { renderDocumentBody } from "./render/document.js";
import { indexSummary, renderIndexCard, renderIndexHeader } from "./render/index-page.js";
import { placeholderFor, stringifyBlocks } from "./split-blocks.js";
import type { ManifestEntry } from "./types.js";

function normalizeHtml(html: string): string {
  return html.replace(/>\s+</g, "><").trim();
}

function assertHtmlEqual(actual: string, expected: string): void {
  assert.equal(normalizeHtml(actual), normalizeHtml(expected));
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

describe("renderDocumentBody", () => {
  it("zips original and translation HTML into ordered row triples, labeled with the block index", () => {
    const [n1] = parseBlocks("");
    const [n2] = parseBlocks("");
    const body = renderDocumentBody("/", ["<p>O1</p>", "<p>O2</p>"], ["<p>T1</p>", "<p>T2</p>"], [n1, n2]);
    assertHtmlEqual(
      body,
      '<p><a href="/">&larr; all documents</a></p><div class="columns">' +
        '<div><p class="block-index">0</p></div><div><p>O1</p></div><div><p>T1</p></div>' +
        '<div><p class="block-index">1</p></div><div><p>O2</p></div><div><p>T2</p></div>' +
        "</div>",
    );
  });

  it("marks only the translation side as untranslated, not the original side", () => {
    const [original] = parseBlocks("Original text.");
    const [untranslatedNode] = parseBlocks(stringifyBlocks([placeholderFor(original)]));
    const body = renderDocumentBody("/", ["<p>O</p>"], ["<p>T</p>"], [untranslatedNode]);
    assertHtmlEqual(
      body,
      '<p><a href="/">&larr; all documents</a></p><div class="columns">' +
        '<div><p class="block-index">0</p></div><div><p>O</p></div><div class="untranslated"><p>T</p></div>' +
        "</div>",
    );
  });

  it("embeds rehype block HTML raw, so a <br> inside a paragraph stays a tag", () => {
    const [n1] = parseBlocks("Line one.<br>\nLine two.");
    const body = renderDocumentBody("/", ["<p>Line one.<br>\nLine two.</p>"], [], [n1]);
    assert.match(body, /<p>Line one\.<br>\nLine two\.<\/p>/);
  });

  it("fills a missing side with an empty string when the two lists differ in length", () => {
    const [n1] = parseBlocks("Переведено.");
    const body = renderDocumentBody("/", ["<p>O1</p>", "<p>O2</p>"], ["<p>T1</p>"], [n1]);
    assertHtmlEqual(
      body,
      '<p><a href="/">&larr; all documents</a></p><div class="columns">' +
        '<div><p class="block-index">0</p></div><div><p>O1</p></div><div><p>T1</p></div>' +
        '<div><p class="block-index">1</p></div><div><p>O2</p></div><div></div>' +
        "</div>",
    );
  });

  it("HTML-escapes backHref, so a literal & in it cannot break out of the href attribute", () => {
    const body = renderDocumentBody("../a & b/index.html", [], [], []);
    assertHtmlEqual(
      body,
      '<p><a href="../a &amp; b/index.html">&larr; all documents</a></p><div class="columns"></div>',
    );
  });

  it("renders a status pill per block and the data the client needs when editable info is given", () => {
    const [n1, n2] = parseBlocks("Переведено.\n\nЕще.");
    const editable = {
      originalPath: "reviewed/Simple.md",
      blocks: [
        { kind: "paragraph" as const, fingerprint: "0000000000000000", status: "complete" as const },
        { kind: "paragraph" as const, fingerprint: "1111111111111111", status: "verified" as const },
      ],
    };
    const body = renderDocumentBody("/", ["<p>O1</p>", "<p>O2</p>"], ["<p>T1</p>", "<p>T2</p>"], [n1, n2], editable);
    assert.match(
      body,
      /<button type="button" class="status-pill status-complete" data-block="0" data-status="complete"/,
    );
    assert.match(body, /<button type="button" class="status-pill status-verified" data-block="1"/);
    assert.match(
      body,
      /<div class="columns" data-original-path="reviewed\/Simple\.md" data-statuses="in-progress complete verified needs-attention">/,
    );
    assert.doesNotMatch(body, /<dialog|<form|<script/);
  });

  it("marks a needs-attention pill with ! and puts the comment in its title", () => {
    const [n1] = parseBlocks("Переведено.");
    const editable = {
      originalPath: "reviewed/Simple.md",
      blocks: [
        {
          kind: "paragraph" as const,
          fingerprint: "0000000000000000",
          status: "needs-attention" as const,
          status_comment: "check this",
        },
      ],
    };
    const body = renderDocumentBody("/", ["<p>O1</p>"], ["<p>T1</p>"], [n1], editable);
    assert.match(body, /title="needs-attention: check this"[^>]*>0!<\/button>/);
  });

  it("renders a plain number, not a pill, for a thematic-break block, which has no text to set status on", () => {
    const [n1] = parseBlocks("---");
    const editable = {
      originalPath: "reviewed/Simple.md",
      blocks: [{ kind: "thematicBreak", fingerprint: "0000000000000000", status: "complete" as const }],
    };
    const body = renderDocumentBody("/", ["<hr>"], ["<hr>"], [n1], editable);
    assert.match(body, /<p class="block-index">0<\/p>/);
    assert.doesNotMatch(body, /<button type="button" class="status-pill/);
  });

  it("renders no pill and no dialog when editable info is omitted, e.g. the static build", () => {
    const [n1] = parseBlocks("Переведено.");
    const body = renderDocumentBody("/", ["<p>O1</p>"], ["<p>T1</p>"], [n1]);
    assert.doesNotMatch(body, /status-pill/);
    assert.doesNotMatch(body, /<dialog|<form|<script/);
  });

  it("escapes & and quotes in a status_comment placed in an attribute", () => {
    const [n1] = parseBlocks("Переведено.");
    const editable = {
      originalPath: "reviewed/Simple.md",
      blocks: [
        {
          kind: "paragraph" as const,
          fingerprint: "0000000000000000",
          status: "needs-attention" as const,
          status_comment: 'check "this" & that',
        },
      ],
    };
    const body = renderDocumentBody("/", ["<p>O1</p>"], ["<p>T1</p>"], [n1], editable);
    assert.match(body, /data-comment="check &quot;this&quot; &amp; that"/);
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

  it("draws a whole not-started bar and the open-the-document caption when nothing is translated", () => {
    const doc = entry({
      blocks: [
        { kind: "paragraph", fingerprint: "1111111111111111", status: "in-progress" },
        { kind: "paragraph", fingerprint: "2222222222222222", status: "in-progress" },
      ],
    });
    const html = renderIndexCard(doc, { translated: 0, total: 2 });
    assert.match(html, /<span class="chip status-not-started">not-started<\/span>/);
    // The manifest says in-progress, but with nothing translated the whole bar is one segment.
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
