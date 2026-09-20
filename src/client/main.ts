/** Entry of the client bundle. The dev server loads it on every page (ADR-016). */
import { PILL_CLASS } from "../dom-names.js";
import { startLiveReload } from "./live-reload.js";
import { startStatusDialog } from "./status-dialog.js";

startLiveReload();
if (document.querySelector(`.${PILL_CLASS}`)) startStatusDialog();
