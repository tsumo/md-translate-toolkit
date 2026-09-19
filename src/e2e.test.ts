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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

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

  it("shows correct status badges on the index page", () => {
    assert.match(indexHtml, /status-needs-attention/);
    assert.match(indexHtml, /status-not-started/);
  });

  it("excludes the thematic-break block from Example.md's translation progress count", () => {
    // Example.md has 7 blocks, but the divider has no text, so `translationProgress` skips it.
    // The total is 6, and 5 are translated (all except the list with a placeholder).
    // A regression in that rule would change this to 5/7 or 6/7.
    assert.match(indexHtml, /5\/6 blocks/);
  });
});

describe("dev server against the fixture project", () => {
  let dir: string;
  let port: number;
  let child: ChildProcessWithoutNullStreams;

  before(async () => {
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

  it("serves Example.md's document page with the untranslated block highlighted and the thematic break unharmed", async () => {
    const res = await fetch(`http://localhost:${port}/doc/Example.md.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Заголовок/);
    assert.match(html, /class="untranslated"/);

    // Block 6 is the divider. It has no text, so it never holds the marker.
    // It is never untranslated, whatever its stored status.
    const thematicBreakRow = html.split('<p class="block-index">6</p>')[1] ?? "";
    const columns = thematicBreakRow.split("</div>").slice(0, 3).join("</div>");
    assert.match(columns, /<hr>/);
    assert.doesNotMatch(columns, /class="untranslated"/);
  });

  it("POST /api/status updates a block and persists it, without touching the checked-in fixture", async () => {
    const res = await fetch(`http://localhost:${port}/api/status`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ path: "Example.md", block: "1", status: "verified", comment: "" }),
      redirect: "manual",
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/doc/Example.md.html");

    const copiedManifest = JSON.parse(readFileSync(join(dir, "manifest/Example.md.json"), "utf-8"));
    assert.equal(copiedManifest.blocks[1].status, "verified");

    const checkedInManifest = JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest/Example.md.json"), "utf-8"));
    assert.equal(checkedInManifest.blocks[1].status, "complete");
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
