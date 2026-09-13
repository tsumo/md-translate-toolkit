# md-translate-toolkit

A config-driven CLI for translating Markdown documents against pinned upstream commits, tracked block by block.
See [DECISIONS.md](DECISIONS.md) for the design rationale.

Originally built for, and extracted out of, a Russian translation of
[Ars Magica Open License](https://github.com/OriginalMadman/Ars-Magica-Open-License).

## Install

```
npm install github:tsumo/md-translate-toolkit#v0.1.0
```

## Configure

Add a `translate.config.js` at your project's root:

```js
/** @type {import('md-translate-toolkit').Config} */
export default {
  upstream: {
    defaultRepo: "owner/repo",
  },
  attribution: {
    licenseName: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
};
```

`paths.manifestDir`/`translationsDir`/`siteDir`/`cacheDir` default to `manifest`, `translations`, `site`, and
`.cache/originals`; set any of them under `paths` to use different names.

## Commands

| Command | What it does |
| --- | --- |
| `md-translate add-source [<path>]` | Claims a new document: fetches it, pins the commit, creates a translation skeleton. |
| `md-translate dev` | Starts a local side-by-side dev server, with live-reload. |
| `md-translate set-status [<path>] <status>` | Marks block(s) `complete`, `verified`, or `needs-attention`. |
| `md-translate build` | Fetches, validates, and checks every manifest and block, then builds a static site. |
| `md-translate pull-updates [<path>]` | Read-only report of what's changed upstream since pinning. Add `--apply` to sync for real. |

Every command also takes `--config <path>` to use a config file other than `translate.config.js` in the current
directory.

## License

MIT — see [LICENSE.md](LICENSE.md).
