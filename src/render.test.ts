import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentToBlockHtml, renderDocumentBody, renderIndexItem } from "./render.js";
import { parseBlocks, placeholderFor, stringifyBlocks } from "./split-blocks.js";
import type { ManifestEntry } from "./types.js";

function normalizeHtml(html: string): string {
  return html.replace(/>\s+</g, "><").trim();
}

function assertHtmlEqual(actual: string, expected: string): void {
  assert.equal(normalizeHtml(actual), normalizeHtml(expected));
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

  it("adds a status badge and set-status form per block when editable info is given", () => {
    const [n1] = parseBlocks("Переведено.");
    const editable = {
      originalPath: "reviewed/Simple.md",
      blocks: [{ kind: "paragraph", fingerprint: "0000000000000000", status: "complete" as const }],
    };
    const body = renderDocumentBody("/", ["<p>O1</p>"], ["<p>T1</p>"], [n1], editable);
    assert.match(body, /<span class="badge status-complete">complete<\/span>/);
    assert.match(body, /<form method="post" action="\/api\/status" class="status-form">/);
    assert.match(body, /<input type="hidden" name="path" value="reviewed\/Simple\.md">/);
    assert.match(body, /<input type="hidden" name="block" value="0">/);
    assert.match(body, /<option value="complete" selected>complete<\/option>/);
    assert.match(body, /<option value="verified">verified<\/option>/);
  });

  it("renders no status form for a thematic-break block, which has no text to set status on", () => {
    const [n1] = parseBlocks("---");
    const editable = {
      originalPath: "reviewed/Simple.md",
      blocks: [{ kind: "thematicBreak", fingerprint: "0000000000000000", status: "complete" as const }],
    };
    const body = renderDocumentBody("/", ["<hr>"], ["<hr>"], [n1], editable);
    assert.doesNotMatch(body, /status-form/);
    assert.doesNotMatch(body, /<form/);
  });

  it("renders no status form at all when editable info is omitted, e.g. the static build", () => {
    const [n1] = parseBlocks("Переведено.");
    const body = renderDocumentBody("/", ["<p>O1</p>"], ["<p>T1</p>"], [n1]);
    assert.doesNotMatch(body, /status-form/);
    assert.doesNotMatch(body, /<form/);
  });

  it("escapes an existing status_comment containing & when prefilling the comment field", () => {
    const [n1] = parseBlocks("Переведено.");
    const editable = {
      originalPath: "reviewed/Simple.md",
      blocks: [
        {
          kind: "paragraph" as const,
          fingerprint: "0000000000000000",
          status: "needs-attention" as const,
          status_comment: "check this & that",
        },
      ],
    };
    const body = renderDocumentBody("/", ["<p>O1</p>"], ["<p>T1</p>"], [n1], editable);
    assert.match(body, /value="check this &amp; that"/);
  });
});

describe("renderIndexItem", () => {
  function entry(overrides: Partial<ManifestEntry>): ManifestEntry {
    return {
      original_path: "reviewed/Simple.md",
      source_repo: "user/Source-Repo",
      source_commit: "abc123",
      source_sha256: "deadbeef",
      translation_path: "translations/reviewed/Simple.md",
      last_synced: "2026-01-01",
      blocks: [],
      ...overrides,
    };
  }

  it("renders the link, status badge, and progress for a fully verified document", () => {
    const doc = entry({
      blocks: [
        { kind: "paragraph", fingerprint: "1111111111111111", status: "verified" },
        { kind: "paragraph", fingerprint: "2222222222222222", status: "verified" },
      ],
    });
    assertHtmlEqual(
      renderIndexItem(doc, { translated: 2, total: 2 }),
      '<li><a href="doc/reviewed/Simple.md.html">reviewed/Simple.md</a>' +
        '<span class="badge status-verified">verified</span>' +
        '<span class="progress">2/2 blocks</span></li>',
    );
  });

  it("lists flagged blocks with their comment, and HTML-escapes both the comment and the & in the href", () => {
    const doc = entry({
      original_path: "reviewed/Some & File.md",
      blocks: [
        { kind: "paragraph", fingerprint: "1111111111111111", status: "complete" },
        {
          kind: "paragraph",
          fingerprint: "2222222222222222",
          status: "needs-attention",
          status_comment: "Check this <b>tag</b>",
        },
      ],
    });
    assertHtmlEqual(
      renderIndexItem(doc, { translated: 1, total: 2 }),
      '<li><a href="doc/reviewed/Some%20&amp;%20File.md.html">reviewed/Some &amp; File.md</a>' +
        '<span class="badge status-needs-attention">needs-attention</span>' +
        '<span class="progress">1/2 blocks</span>' +
        '<span class="badge status-needs-attention">1 flagged</span>' +
        '<ul class="flagged"><li>block 1: Check this &lt;b&gt;tag&lt;/b&gt;</li></ul></li>',
    );
  });
});
