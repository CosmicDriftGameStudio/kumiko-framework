import { type CSSProperties, useMemo, useState } from "react";
import type {
  DataTableColumnWidths,
  DataTableViewOptions,
} from "../../../data-table-view-types.ts";
import { DEFAULT_COLUMN_WIDTH_PX } from "../../../hooks/list-column-layout.ts";
import { isResizingActive } from "./column-layout-mode.ts";
import {
  EXPAND_COLUMN_WIDTH_PX,
  type MeasuredColumnWidths,
  SELECT_COLUMN_WIDTH_PX,
} from "./use-measured-column-widths.ts";

export type ColumnSizing = {
  /** False until a column has a chosen width: the table keeps the auto layout and sizes columns by content. */
  readonly fixed: boolean;
  readonly widthOf: (field: string) => number;
  readonly minWidthOf: (field: string) => number;
  readonly tableStyle: CSSProperties | undefined;
  /** Live width while a drag is in progress; nothing reaches the view state until `commit`. */
  readonly setLiveWidth: (field: string, width: number) => void;
  readonly commit: (field: string, width: number) => void;
};

type LiveWidth = {
  readonly field: string;
  readonly width: number;
  readonly frozen: DataTableColumnWidths;
};

/** Sizing for resizable columns; undefined when resizing is off. */
export function useColumnSizing({
  columns,
  view,
  isNarrow,
  measured,
  hasExpandColumn,
  hasSelectColumn = false,
}: {
  readonly columns: readonly { readonly field: string }[];
  readonly view: DataTableViewOptions | undefined;
  readonly isNarrow: boolean;
  readonly measured: MeasuredColumnWidths | undefined;
  readonly hasExpandColumn: boolean;
  readonly hasSelectColumn?: boolean;
}): ColumnSizing | undefined {
  const [live, setLive] = useState<LiveWidth | null>(null);
  const active = isResizingActive(view, isNarrow);
  const widths = view?.widths;
  const minWidths = view?.minWidths;
  const onWidthChange = view?.onWidthChange;

  return useMemo(() => {
    if (!active || widths === undefined || minWidths === undefined) return undefined;
    const minWidthOf = (field: string): number => minWidths[field] ?? 0;
    const fixed = live !== null || columns.some((column) => widths[column.field] !== undefined);
    // Columns without a chosen width keep the width the auto layout gave them, so the
    // first drag moves one column instead of snapping every other one to a default.
    const displayedWidths = (): DataTableColumnWidths => live?.frozen ?? measured?.fields ?? {};
    const widthOf = (field: string): number => {
      if (live?.field === field) return live.width;
      const chosen = widths[field];
      if (chosen !== undefined) return chosen;
      const displayed = displayedWidths()[field];
      if (displayed !== undefined && displayed > 0) return displayed;
      return fixed ? Math.max(DEFAULT_COLUMN_WIDTH_PX, minWidthOf(field)) : minWidthOf(field);
    };
    const unchosenDisplayedWidths = (dragged: string): DataTableColumnWidths =>
      Object.fromEntries(
        columns
          .filter((column) => column.field !== dragged && widths[column.field] === undefined)
          .map((column) => [column.field, widthOf(column.field)]),
      );
    // The actions column keeps no width of its own: it absorbs the leftover space,
    // so a dragged width holds exactly while the table is wider than its container.
    const total =
      columns.reduce((sum, column) => sum + widthOf(column.field), 0) +
      (hasExpandColumn ? EXPAND_COLUMN_WIDTH_PX : 0) +
      (hasSelectColumn ? SELECT_COLUMN_WIDTH_PX : 0) +
      (measured?.actions ?? 0);
    return {
      fixed,
      widthOf,
      minWidthOf,
      tableStyle: fixed ? { tableLayout: "fixed", width: `max(100%, ${total}px)` } : undefined,
      setLiveWidth: (field, width) =>
        setLive((previous) => ({
          field,
          width,
          frozen: previous?.frozen ?? { ...measured?.fields },
        })),
      commit: (field, width) => {
        const others = unchosenDisplayedWidths(field);
        setLive(null);
        onWidthChange?.(field, width, others);
      },
    };
  }, [
    active,
    widths,
    minWidths,
    live,
    columns,
    hasExpandColumn,
    hasSelectColumn,
    measured,
    onWidthChange,
  ]);
}
