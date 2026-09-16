# Example fixture project

A small, self-contained consumer project used to test `md-translate-toolkit` itself: two claimed
documents (`Example.md`, covering every block kind and status; `Fresh.md`, an untouched skeleton),
with their pinned "original" content already cached under `.cache/originals/`, so `dev`/`build` run
here without any network access.

Used by `src/e2e.test.ts` (which always runs against a temporary copy, never this directory
directly) and for manual, visual checks:

```
cd fixtures/example
node ../../src/cli.js dev --port 4200
```

The dev server's set-status form writes to `manifest/*.json` on disk. If you use it here directly
instead of via a copy, run `git checkout fixtures/example` afterward to discard the change.

`node ../../src/cli.js build` writes to `site/`, which is gitignored — safe to delete any time.
