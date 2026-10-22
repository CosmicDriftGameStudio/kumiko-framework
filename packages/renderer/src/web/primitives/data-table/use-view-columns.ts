import { useMemo } from "react";
import type { DataTableViewOptions } from "../../../data-table-view-types.ts";

/** Visibility always applies; the order only in the table layout, since the card
 *  layout derives its title/status/meta roles from the column sequence. */
export function useViewColumns<TColumn extends { readonly field: string }>(
  columns: readonly TColumn[],
  view: DataTableViewOptions | undefined,
  isNarrow: boolean,
): readonly TColumn[] {
  const viewColumns = view?.columns;
  return useMemo(() => {
    if (viewColumns === undefined) return columns;
    const hidden = new Set(viewColumns.filter((c) => !c.visible).map((c) => c.field));
    const visible = columns.filter((column) => !hidden.has(column.field));
    if (isNarrow) return visible;
    const position = new Map(viewColumns.map((c, index) => [c.field, index]));
    const positionOf = (column: TColumn): number =>
      position.get(column.field) ?? Number.MAX_SAFE_INTEGER;
    return [...visible].sort((a, b) => positionOf(a) - positionOf(b));
  }, [columns, viewColumns, isNarrow]);
}
