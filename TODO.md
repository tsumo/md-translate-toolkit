# TODO

Planned features, possible research opportunities. This is a scratchpad, not a changelog. Items will be deleted after
they get implemented or proved not worthy after the research.

- `src/scripts/dev.ts` translation-side render caching: once translated content is as heavy as the original, a full
  `remark-parse` of the whole translation file on every edit-triggered reload gets slow again.

- In-browser editable panes, if plain-file editing turns out to be ergonomically painful in practice.

- Render color-coded bar for file translation progress.

- `src/scripts/dev.ts` `/api/status` endpoint: validate the `path` form field. It goes into the manifest path
  unchecked, so a crafted value such as `../../x` can read or write files outside the manifest folder.

- css vars for status colors
