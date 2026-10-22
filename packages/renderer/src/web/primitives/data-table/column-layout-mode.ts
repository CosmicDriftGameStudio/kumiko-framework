import type { DataTableViewOptions } from "../../../data-table-view-types.ts";

/** Pinning, resizing and keyboard navigation only apply to the table layout (md and up). */
export function isPinningActive(
  view: DataTableViewOptions | undefined,
  isNarrow: boolean,
): boolean {
  return !isNarrow && view?.pins !== undefined;
}

export function isResizingActive(
  view: DataTableViewOptions | undefined,
  isNarrow: boolean,
): boolean {
  return !isNarrow && view?.widths !== undefined && view.minWidths !== undefined;
}

export function isKeyboardNavigationActive(
  view: DataTableViewOptions | undefined,
  isNarrow: boolean,
): boolean {
  return !isNarrow && view?.keyboardNavigation === true;
}
