/**
 * End-to-end tests on `fixtures/example/`, the example consumer project. Each test works on a fresh copy of the
 * fixture, because the dev server writes the manifest and would dirty the working tree.
 *
 * The tests spawn the real `cli.js` for `build` and `dev`. `loadConfig` reads the folder from `process.cwd()`,
 * so the process must run in the copy. This also tests the command dispatch in `cli.js`.
 *
 * The copy goes under `.tmp/` in the repository, not in the OS temp folder. Node finds the module type of the
 * config file from the nearest `package.json`, and a copy in the OS temp folder has none.
 */
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Script } from "node:vm";

const CLI_PATH = join(import.meta.dirname, "cli.js");
const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/example");
const FIXTURE_COMMIT = "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";
const SCRATCH_DIR = join(import.meta.dirname, "../.tmp");

function copyFixture(): string {
  mkdirSync(SCRATCH_DIR, { recursive: true });
  const dir = mkdtempSync(join(SCRATCH_DIR, "e2e-"));
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to get a free port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function waitForServerReady(child: ChildProcessWithoutNullStreams, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dev server did not start in time")), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("running at")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("build against the fixture project", () => {
  let dir: string;
  let indexHtml: string;

  before(() => {
    dir = copyFixture();
    execFileSync("node", [CLI_PATH, "build"], { cwd: dir });
    indexHtml = readFileSync(join(dir, "site/index.html"), "utf-8");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces a page for every document, with no crash despite an unresolvable upstream repo", () => {
    assert.ok(existsSync(join(dir, "site/doc/Example.md.html")));
    assert.ok(existsSync(join(dir, "site/doc/Fresh.md.html")));
  });

  it("shows correct status chips on the index page", () => {
    assert.match(indexHtml, /status-needs-attention/);
    assert.match(indexHtml, /status-not-started/);
    // The header summary across both fixture documents: 5 claimed blocks of 11, 1 needs-attention.
    // "Claimed" is a complete or verified status; the needs-attention quote, the in-progress
    // paragraph, and the three untranslated blocks are not claimed.
    assert.match(indexHtml, /md-translate/);
    assert.match(indexHtml, /2 documents · 5 of 11 blocks · 1 needs-attention/);
  });

  it("links one shared stylesheet from every page, with no inline style block", () => {
    const css = readFileSync(join(dir, "site/assets/page.css"), "utf-8");
    assert.ok(css.trim().length > 0);
    const exampleHtml = readFileSync(join(dir, "site/doc/Example.md.html"), "utf-8");
    assert.match(indexHtml, /<link rel="stylesheet" href="assets\/page\.css">/);
    assert.match(exampleHtml, /<link rel="stylesheet" href="\.\.\/assets\/page\.css">/);
    assert.doesNotMatch(indexHtml, /<style/);
    assert.doesNotMatch(exampleHtml, /<style/);
  });

  it("ships no client script, status pill, editor cell, dialog or muted source in any built page", () => {
    const exampleHtml = readFileSync(join(dir, "site/doc/Example.md.html"), "utf-8");
    for (const html of [indexHtml, exampleHtml]) {
      assert.doesNotMatch(html, /client\.js|status-pill|block-cell|<dialog|html-source/);
    }
  });

  it("counts only claimed blocks in Example.md's translation progress", () => {
    // Example.md has 10 blocks. The divider never counts, so the total is 9. The claimed count is
    // the complete-or-verified statuses: heading, paragraph, table, code, and the anchor html.
    // The needs-attention quote, the in-progress paragraph, and the two untranslated blocks are
    // not claimed. A regression would change this to 6/9 or 4/9.
    assert.match(indexHtml, /5 of 9 blocks translated · 1 needs-attention/);
  });

  it("summarizes needs-attention as a count on the built index, without the block comment", () => {
    // Example.md block 2 is needs-attention, and its fixture comment holds a literal <quote> and
    // "house" quotes. The card shows the count only, so the comment appears nowhere on the page.
    assert.match(indexHtml, /1 needs-attention/);
    assert.doesNotMatch(indexHtml, /<quote>|house/);
  });
});

// The CLI pins the repo tsconfig for tsx (src/cli.js), so a consumer tsconfig with a conflicting
// `"jsx"` setting cannot change how the JSX pages compile.
describe("build from a directory with a conflicting tsconfig", () => {
  let dir: string;
  let indexHtml: string;

  before(() => {
    dir = copyFixture();
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react" } }));
    execFileSync("node", [CLI_PATH, "build"], { cwd: dir });
    indexHtml = readFileSync(join(dir, "site/index.html"), "utf-8");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("still builds correct pages", () => {
    assert.match(indexHtml, /status-needs-attention/);
    assert.match(indexHtml, /5 of 9 blocks translated/);
    assert.doesNotMatch(indexHtml, /<quote>/);
  });
});

describe("dev server against the fixture project", () => {
  let dir: string;
  let port: number;
  let child: ChildProcessWithoutNullStreams;
  // Every write below must land in the copy. These baselines let the last test hold the suite to that.
  const checkedInFiles = ["translations/Example.md", "manifest/Example.md.json"];
  let checkedInContent: string[] = [];

  before(async () => {
    checkedInContent = checkedInFiles.map((name) => readFileSync(join(FIXTURE_DIR, name), "utf-8"));
    dir = copyFixture();
    port = await getFreePort();
    child = spawn("node", [CLI_PATH, "dev", "--port", String(port)], { cwd: dir });
    await waitForServerReady(child);
  });

  after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the index page with both documents and their badges", async () => {
    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /doc\/Example\.md\.html/);
    assert.match(html, /doc\/Fresh\.md\.html/);
    assert.match(html, /status-needs-attention/);
    assert.match(html, /status-not-started/);
  });

  it("serves the stylesheet and links it from the index and document pages", async () => {
    const css = await fetch(`http://localhost:${port}/assets/page.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    assert.ok((await css.text()).trim().length > 0);
    for (const path of ["/", "/doc/Example.md.html"]) {
      const html = await (await fetch(`http://localhost:${port}${path}`)).text();
      assert.match(html, /<link rel="stylesheet" href="\/assets\/page\.css">/);
      assert.doesNotMatch(html, /<style/);
    }
  });

  it("serves a client bundle that parses, and loads it on the index and document pages", async () => {
    const js = await fetch(`http://localhost:${port}/assets/client.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /text\/javascript/);
    const body = await js.text();
    assert.doesNotThrow(() => new Script(body));
    for (const path of ["/", "/doc/Example.md.html"]) {
      const html = await (await fetch(`http://localhost:${port}${path}`)).text();
      assert.match(html, /<script src="\/assets\/client\.js"/);
    }
  });

  it("serves Example.md's document page with editable cells, the untranslated block highlighted, and the thematic break unmarked", async () => {
    const res = await fetch(`http://localhost:${port}/doc/Example.md.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Заголовок/);
    // Block 3 is the untranslated list: highlighted and openable in the inline block editor.
    assert.match(html, /class="cell untranslated block-cell" data-block="3"/);
    // Block 1 is a plain translated paragraph: openable, without the highlight.
    assert.match(html, /class="cell block-cell" data-block="1"/);
    assert.match(html, /<span class="status-pill [^"]*" data-block="0"/);
    assert.match(html, /<div class="doc-grid" data-original-path="Example\.md" data-statuses="[^"]+">/);
    assert.doesNotMatch(html, /<dialog/);

    // Block 6 is the divider. It holds no text, so it is never untranslated, and the editor never
    // opens for it. Its rail shows the toolkit-owned verified pill, colored like any other block's.
    const dividerRow = html.split('<div class="block-row block-row-divider">')[1] ?? "";
    const columns = dividerRow.split("</div>").slice(0, 3).join("</div>");
    assert.match(columns, /<hr>/);
    assert.match(columns, /<span class="status-pill status-verified" data-block="6"/);
    assert.doesNotMatch(columns, /class="untranslated|class="block-cell"/);
  });

  it("serves Example.md's html blocks as muted source, with the markup never rendered raw", async () => {
    const res = await fetch(`http://localhost:${port}/doc/Example.md.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    // Blocks 7 and 8 are raw html: the dev server shows their markup as escaped muted source.
    assert.match(html, /<pre class="html-source">&lt;!-- p\. 42 --&gt;/);
    assert.match(html, /&lt;div class=&quot;note&quot;&gt;/);
    assert.doesNotMatch(html, /<a id="page-42"><\/a>/);
    // Block 8 has the untranslated status, so it is highlighted and openable like any untranslated block.
    assert.match(html, /class="cell untranslated block-cell" data-block="8"/);
  });

  it("escapes a needs-attention comment holding <, > and quotes in the pill attributes", async () => {
    // Example.md block 2's fixture comment holds a literal <quote> and "house" quotes. The title and
    // data-comment attributes must carry the escaped forms only, or the characters could break them.
    const res = await fetch(`http://localhost:${port}/doc/Example.md.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /&lt;quote&gt; against the &quot;house&quot; style guide/);
    assert.doesNotMatch(html, /<quote>/);
  });

  it("POST /api/block writes the text at the block's position and keeps the status", async () => {
    const translationPath = join(dir, "translations/Example.md");
    const manifestPath = join(dir, "manifest/Example.md.json");
    const translationBefore = readFileSync(translationPath, "utf-8");
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));

    const newText = "Исправленный абзац с новой правкой переводчика.";
    const res = await fetch(`http://localhost:${port}/api/block`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        path: "Example.md",
        block: "1",
        text: newText,
        // The editor sends the block's current status back unchanged.
        status: manifestBefore.blocks[1].status,
        comment: manifestBefore.blocks[1].status_comment ?? "",
      }),
    });
    assert.equal(res.status, 204);

    // Everything outside block 1's own source stays byte-identical.
    assert.equal(readFileSync(translationPath, "utf-8"), translationBefore.replace("Переведённый абзац.", newText));

    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
    assert.deepEqual(manifestAfter.blocks[1], manifestBefore.blocks[1]);
    assert.deepEqual(manifestAfter.blocks.slice(2), manifestBefore.blocks.slice(2));
  });

  it("POST /api/block passes a needs-attention block's comment through unchanged", async () => {
    const translationPath = join(dir, "translations/Example.md");
    const manifestPath = join(dir, "manifest/Example.md.json");
    const translationBefore = readFileSync(translationPath, "utf-8");
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const comment = manifestBefore.blocks[2].status_comment;

    const res = await fetch(`http://localhost:${port}/api/block`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        path: "Example.md",
        block: "2",
        text: "> Исправленная цитата.",
        status: "needs-attention",
        comment,
      }),
    });
    assert.equal(res.status, 204);
    assert.equal(
      readFileSync(translationPath, "utf-8"),
      translationBefore.replace("Переведённая цитата.", "Исправленная цитата."),
    );

    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
    assert.equal(manifestAfter.blocks[2].status, "needs-attention");
    assert.equal(manifestAfter.blocks[2].status_comment, comment);
  });

  it("POST /api/block rejects invalid submissions and leaves both files untouched", async () => {
    const translationPath = join(dir, "translations/Example.md");
    const manifestPath = join(dir, "manifest/Example.md.json");
    const translationBefore = readFileSync(translationPath, "utf-8");
    const manifestBefore = readFileSync(manifestPath, "utf-8");

    const rejections: { name: string; body: Record<string, string> }[] = [
      { name: "two paragraphs", body: { block: "1", text: "Первый абзац.\n\nВторой абзац.", status: "complete" } },
      { name: "wrong kind", body: { block: "1", text: "# Заголовок вместо абзаца", status: "complete" } },
      { name: "empty text", body: { block: "1", text: "  \n ", status: "complete" } },
      { name: "scaffold-only text", body: { block: "2", text: "> ", status: "needs-attention", comment: "note" } },
    ];
    for (const { name, body } of rejections) {
      const res = await fetch(`http://localhost:${port}/api/block`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ path: "Example.md", ...body }),
      });
      assert.equal(res.status, 400, name);
      assert.ok((await res.text()).trim().length > 0, `${name}: the rejection carries a reason`);
    }

    assert.equal(readFileSync(translationPath, "utf-8"), translationBefore);
    assert.equal(readFileSync(manifestPath, "utf-8"), manifestBefore);
  });

  it("refuses traversal and malformed block fields", async () => {
    const translationPath = join(dir, "translations/Example.md");
    const manifestPath = join(dir, "manifest/Example.md.json");
    const translationBefore = readFileSync(translationPath, "utf-8");
    const manifestBefore = readFileSync(manifestPath, "utf-8");

    const saves = [
      new URLSearchParams({ path: "../outside", block: "1", text: "Абзац.", status: "complete" }),
      new URLSearchParams({ path: "", block: "1", text: "Абзац.", status: "complete" }),
      new URLSearchParams({ path: "Example.md", block: "", text: "Абзац.", status: "complete" }),
      new URLSearchParams({ path: "Example.md", block: "-1", text: "Абзац.", status: "complete" }),
      new URLSearchParams({ path: "Example.md", block: "nope", text: "Абзац.", status: "complete" }),
    ];
    for (const body of saves) {
      const res = await fetch(`http://localhost:${port}/api/block`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      assert.equal(res.status, 400, `POST /api/block ${body}`);
    }

    assert.equal(readFileSync(translationPath, "utf-8"), translationBefore);
    assert.equal(readFileSync(manifestPath, "utf-8"), manifestBefore);
  });

  it("POST /api/block applies an edit together with a status change", async () => {
    const translationPath = join(dir, "translations/Example.md");
    const manifestPath = join(dir, "manifest/Example.md.json");
    const currentText = "Исправленный абзац с новой правкой переводчика.";
    const post = (text: string, status: string) =>
      fetch(`http://localhost:${port}/api/block`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ path: "Example.md", block: "1", text, status, comment: "" }),
      });

    // The fixture ships block 1 complete. Move it off complete first, so the save below really changes
    // the status. The text goes through unchanged.
    const arranged = await post(currentText, "in-progress");
    assert.equal(arranged.status, 204);

    const translationBefore = readFileSync(translationPath, "utf-8");
    const newText = "Ещё раз исправленный абзац.";
    const res = await post(newText, "complete");
    assert.equal(res.status, 204);
    assert.equal(readFileSync(translationPath, "utf-8"), translationBefore.replace(currentText, newText));

    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
    assert.equal(manifestAfter.blocks[1].status, "complete");
    assert.equal(manifestAfter.blocks[1].status_comment, undefined);
  });

  it("POST /api/block transitions a comment: kept, cleared, and required", async () => {
    const translationPath = join(dir, "translations/Example.md");
    const manifestPath = join(dir, "manifest/Example.md.json");
    // Block 3 is untranslated. The transitions below replace its text with a real translation.
    const listText = "- Первый пункт.\n- Второй пункт.";
    const post = (status: string, comment?: string) =>
      fetch(`http://localhost:${port}/api/block`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          path: "Example.md",
          block: "3",
          text: listText,
          status,
          ...(comment === undefined ? {} : { comment }),
        }),
      });

    // Kept: needs-attention with a comment stores both.
    const kept = await post("needs-attention", "check this list");
    assert.equal(kept.status, 204);
    const afterKept = JSON.parse(readFileSync(manifestPath, "utf-8"));
    assert.equal(afterKept.blocks[3].status, "needs-attention");
    assert.equal(afterKept.blocks[3].status_comment, "check this list");

    // Cleared: the emptied field stores no comment, and an empty string never reaches the manifest.
    const cleared = await post("in-progress", "");
    assert.equal(cleared.status, 204);
    const afterCleared = JSON.parse(readFileSync(manifestPath, "utf-8"));
    assert.equal(afterCleared.blocks[3].status, "in-progress");
    assert.equal(afterCleared.blocks[3].status_comment, undefined);

    // Required: needs-attention without a comment is refused and both files stay untouched.
    const translationBefore = readFileSync(translationPath, "utf-8");
    const manifestBefore = readFileSync(manifestPath, "utf-8");
    const required = await post("needs-attention");
    assert.equal(required.status, 400);
    assert.match(await required.text(), /comment/);
    assert.equal(readFileSync(translationPath, "utf-8"), translationBefore);
    assert.equal(readFileSync(manifestPath, "utf-8"), manifestBefore);
  });

  it("leaves the checked-in fixture untouched; every write went to the copy", () => {
    for (const [i, name] of checkedInFiles.entries()) {
      assert.equal(readFileSync(join(FIXTURE_DIR, name), "utf-8"), checkedInContent[i], name);
    }
  });
});

// Checks that the commit in this file matches the fixture manifests, so a change to only one fails here.
describe("fixture project sanity", () => {
  it("uses the same pinned commit in both manifest entries", () => {
    const example = JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest/Example.md.json"), "utf-8"));
    const fresh = JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest/Fresh.md.json"), "utf-8"));
    assert.equal(example.source_commit, FIXTURE_COMMIT);
    assert.equal(fresh.source_commit, FIXTURE_COMMIT);
  });
});
