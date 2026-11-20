import type { ListColumnViewModel } from "../../../headless/index.ts";

/** A column that is a per-row action link or button: right-aligned from sm with a screen-reader-only header. */
export function isRowActionColumn(col: ListColumnViewModel): boolean {
  return col.rowActionLink === true || col.display === "button";
}

/** Only the trailing row-action column pins to the right edge, and only when no "⋯" column already holds that edge. */
export function isStickyRowActionColumn(
  columns: readonly ListColumnViewModel[],
  col: ListColumnViewModel,
  hasTableActions: boolean,
): boolean {
  return !hasTableActions && isRowActionColumn(col) && columns[columns.length - 1] === col;
}
