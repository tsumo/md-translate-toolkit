/** The page shell shared by the dev server and the static build. */
import { html, raw } from "hono/html";

/** Page-level settings that differ between the dev server and the static build. */
export interface PageOptions {
  /** The `href` of the shared stylesheet. */
  stylesheetHref: string;
  /** HTML that follows the body, such as a live-reload script. It is trusted and not escaped. */
  extraBodyHtml?: string;
}

/** The page shell around `bodyHtml`, which is trusted HTML and is not escaped. */
export function pageWrapper(title: string, bodyHtml: string, options: PageOptions): string {
  const { stylesheetHref, extraBodyHtml = "" } = options;
  return `<!doctype html>${
    (
      // biome-ignore lint/a11y/useHtmlLang: the document language is not known here.
      <html>
        {/* The `html` tag escapes values and writes void elements without a closing slash. */}
        <head>
          {html`<meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="${stylesheetHref}">`}
        </head>
        <body>
          {raw(bodyHtml)}
          {raw(extraBodyHtml)}
        </body>
      </html>
    )
  }`;
}
