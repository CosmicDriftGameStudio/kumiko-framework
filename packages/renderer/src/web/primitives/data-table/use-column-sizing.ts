import { type CSSProperties, useCallback, useMemo, useState } from "react";
import type { DataTableViewOptions } from "../../../data-table-view-types.ts";
import { isResizingActive } from "./column-layout-mode.ts";
import { EXPAND_COLUMN_WIDTH_PX, type MeasuredColumnWidths } from "./use-measured-column-widths.ts";

export type ColumnSizing = {
  readonly widthOf: (field: string) => number;
  readonly minWidthOf: (field: string) => number;
  readonly tableStyle: CSSProperties;
  /** Live width while a drag is in progress; nothing reaches the view state until `commit`. */
  readonly setLiveWidth: (field: string, width: number) => void;
  readonly commit: (field: string, width: number) => void;
};

/** Fixed-layout sizing for resizable columns; undefined when resizing is off. */
export function useColumnSizing({
  columns,
  view,
  isNarrow,
  measured,
  hasExpandColumn,
}: {
  readonly columns: readonly { readonly field: string }[];
  readonly view: DataTableViewOptions | undefined;
  readonly isNarrow: boolean;
  readonly measured: MeasuredColumnWidths | undefined;
  readonly hasExpandColumn: boolean;
}): ColumnSizing | undefined {
  const [live, setLive] = useState<{ readonly field: string; readonly width: number } | null>(null);
  const active = isResizingActive(view, isNarrow);
  const widths = view?.widths;
  const minWidths = view?.minWidths;
  const onWidthChange = view?.onWidthChange;
  const commit = useCallback(
    (field: string, width: number) => {
      setLive(null);
      onWidthChange?.(field, width);
    },
    [onWidthChange],
  );

  return useMemo(() => {
    if (!active || widths === undefined || minWidths === undefined) return undefined;
    const minWidthOf = (field: string): number => minWidths[field] ?? 0;
    const widthOf = (field: string): number =>
      live?.field === field ? live.width : (widths[field] ?? minWidthOf(field));
    // The actions column keeps no width of its own: it absorbs the leftover space,
    // so a dragged width holds exactly while the table is wider than its container.
    const total =
      columns.reduce((sum, column) => sum + widthOf(column.field), 0) +
      (hasExpandColumn ? EXPAND_COLUMN_WIDTH_PX : 0) +
      (measured?.actions ?? 0);
    return {
      widthOf,
      minWidthOf,
      tableStyle: { tableLayout: "fixed", width: `max(100%, ${total}px)` },
      setLiveWidth: (field, width) => setLive({ field, width }),
      commit,
    };
  }, [active, widths, minWidths, live, columns, hasExpandColumn, measured, commit]);
}
