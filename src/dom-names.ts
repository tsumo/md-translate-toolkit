/** Names that the server markup and the client code share, so the two sides cannot drift apart. */

export const PILL_CLASS = "status-pill";

/** On a translation cell that a click opens in the inline block editor. Only the dev server sets it. */
export const CELL_CLASS = "block-cell";

/** The wrapper of one block row: original cell, rail, translation cell. The phone layout styles it as a card. */
export const BLOCK_ROW_CLASS = "block-row";

/** On the original cell of a block row, which the mobile editor restates as its reference strip. */
export const ORIG_CLASS = "orig";

export const ATTR_BLOCK = "data-block";
export const ATTR_STATUS = "data-status";
export const ATTR_COMMENT = "data-comment";
/** On the `.doc-grid` element: the original path of the document. */
export const ATTR_ORIGINAL_PATH = "data-original-path";
/** On the `.doc-grid` element: the valid block statuses, separated by spaces. */
export const ATTR_STATUSES = "data-statuses";
