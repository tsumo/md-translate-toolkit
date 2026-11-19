/** Entry of the client bundle. The dev server loads it on every page (ADR-016). */
import { CELL_CLASS, PILL_CLASS } from "../dom-names.js";
import { startInlineEditor } from "./inline-editor.js";
import { startLiveReload } from "./live-reload.js";
import { startStatusDialog } from "./status-dialog.js";

startLiveReload();
if (document.querySelector(`.${PILL_CLASS}`)) startStatusDialog();
if (document.querySelector(`.${CELL_CLASS}`)) startInlineEditor();
