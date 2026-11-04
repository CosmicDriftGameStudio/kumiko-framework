import type { ListColumnViewModel } from "../../../headless/index.ts";

/** A column that is a per-row action link or button: right-aligned from sm with a screen-reader-only header. */
export function isRowActionColumn(col: ListColumnViewModel): boolean {
  return col.rowActionLink === true || col.display === "button";
}
