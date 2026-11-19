/**
 * Renders JSX into a detached fragment of real DOM nodes. The hono dom runtime mounts vnodes with `render()`
 * rather than returning nodes from `jsx()`, so call sites mount, then place the fragment.
 */

import { render } from "hono/jsx/dom";
import type { JSX } from "hono/jsx/dom/jsx-runtime";

export function renderFragment(element: JSX.Element): DocumentFragment {
  const fragment = document.createDocumentFragment();
  render(element, fragment);
  return fragment;
}
