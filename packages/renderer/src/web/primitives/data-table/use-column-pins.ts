import { type CSSProperties, useMemo } from "react";
import type { DataTableColumnPin, DataTableViewOptions } from "../../../data-table-view-types.ts";
import { cn } from "../../lib/cn.ts";
import { isPinningActive } from "./column-layout-mode.ts";
import type { MeasuredColumnWidths } from "./use-measured-column-widths.ts";
import { ROW_FOCUS_RING_CELL_CLASS } from "./use-row-keyboard-navigation.ts";

export const EXPAND_COLUMN_KEY = "__expand";

// Header over pins over actions (10) over cells. Header z-index 30 also lifts
// the sticky scrollBody header, whose class selector would otherwise set 10.
const HEADER_Z_INDEX = 30;
const PINNED_HEADER_Z_INDEX = 40;
const PINNED_BODY_Z_INDEX = 20;

type PinPlacement = {
  readonly side: DataTableColumnPin;
  readonly offset: number;
  readonly onInnerEdge: boolean;
};

export type PinnedCellProps = {
  readonly style?: CSSProperties;
  readonly className?: string;
};

export type PinnedHeaderCellProps = PinnedCellProps & { readonly columnField?: string };

export type ColumnPins<TColumn> = {
  readonly columns: readonly TColumn[];
  readonly headerCell: (field: string) => PinnedHeaderCellProps;
  readonly bodyCell: (field: string) => PinnedCellProps;
  readonly actionsHeaderStyle: CSSProperties | undefined;
};

function pinOf(
  view: DataTableViewOptions | undefined,
  field: string,
): DataTableColumnPin | undefined {
  return view?.pins?.[field];
}

function placePins(
  columns: readonly { readonly field: string }[],
  pinOfField: (field: string) => DataTableColumnPin | undefined,
  measured: MeasuredColumnWidths,
  hasExpandColumn: boolean,
  hasActionsColumn: boolean,
): ReadonlyMap<string, PinPlacement> {
  const placements = new Map<string, PinPlacement>();
  const widthOf = (field: string): number => measured.fields[field] ?? 0;
  const leftFields = columns.filter((c) => pinOfField(c.field) === "left").map((c) => c.field);
  const rightFields = columns.filter((c) => pinOfField(c.field) === "right").map((c) => c.field);

  if (hasExpandColumn && leftFields.length > 0) {
    placements.set(EXPAND_COLUMN_KEY, { side: "left", offset: 0, onInnerEdge: false });
  }
  let left = hasExpandColumn && leftFields.length > 0 ? measured.expand : 0;
  leftFields.forEach((field, index) => {
    placements.set(field, {
      side: "left",
      offset: left,
      onInnerEdge: index === leftFields.length - 1,
    });
    left += widthOf(field);
  });
  let right = hasActionsColumn ? measured.actions : 0;
  for (let index = rightFields.length - 1; index >= 0; index--) {
    const field = rightFields[index];
    if (field === undefined) continue;
    placements.set(field, { side: "right", offset: right, onInnerEdge: index === 0 });
    right += widthOf(field);
  }
  return placements;
}

function pinnedStyle(
  placement: PinPlacement,
  part: "header" | "body",
  fillsHeight: boolean,
): CSSProperties {
  const edgeLine = placement.side === "left" ? "inset -1px 0 0" : "inset 1px 0 0";
  const shadows: string[] = [];
  if (placement.onInnerEdge) shadows.push(`${edgeLine} var(--color-border)`);
  if (part === "header" && fillsHeight) shadows.push("inset 0 -1px 0 var(--color-border)");
  return {
    position: "sticky",
    [placement.side]: placement.offset,
    zIndex: part === "header" ? PINNED_HEADER_Z_INDEX : PINNED_BODY_Z_INDEX,
    ...(shadows.length > 0 && { boxShadow: shadows.join(", ") }),
  };
}

function pinnedClassName(part: "header" | "body", fillsHeight: boolean): string {
  if (part === "header") return "bg-muted";
  return cn(fillsHeight ? "bg-card" : "bg-background", ROW_FOCUS_RING_CELL_CLASS);
}

/** Reorders columns (left pins first, right pins last) and computes the sticky
 *  styles of pinned cells. Inactive: columns unchanged, no styles. */
export function useColumnPins<TColumn extends { readonly field: string }>({
  columns,
  view,
  isNarrow,
  measured,
  hasActionsColumn,
  hasExpandColumn,
  fillsHeight,
}: {
  readonly columns: readonly TColumn[];
  readonly view: DataTableViewOptions | undefined;
  readonly isNarrow: boolean;
  readonly measured: MeasuredColumnWidths | undefined;
  readonly hasActionsColumn: boolean;
  readonly hasExpandColumn: boolean;
  readonly fillsHeight: boolean;
}): ColumnPins<TColumn> {
  const active = isPinningActive(view, isNarrow);
  const pins = view?.pins;
  const ordered = useMemo(() => {
    if (!active) return columns;
    const pinFor = (column: TColumn): DataTableColumnPin | undefined => pins?.[column.field];
    return [
      ...columns.filter((c) => pinFor(c) === "left"),
      ...columns.filter((c) => pinFor(c) === undefined),
      ...columns.filter((c) => pinFor(c) === "right"),
    ];
  }, [active, columns, pins]);

  return useMemo(() => {
    const placements = active
      ? placePins(
          ordered,
          (field) => pinOf(view, field),
          measured ?? { fields: {}, expand: 0, actions: 0 },
          hasExpandColumn,
          hasActionsColumn,
        )
      : new Map<string, PinPlacement>();
    const cellProps = (field: string, part: "header" | "body"): PinnedCellProps => {
      if (!active) return {};
      const placement = placements.get(field);
      if (placement === undefined) {
        return part === "header" ? { style: { zIndex: HEADER_Z_INDEX } } : {};
      }
      return {
        style: pinnedStyle(placement, part, fillsHeight),
        className: pinnedClassName(part, fillsHeight),
      };
    };
    return {
      columns: ordered,
      headerCell: (field) => ({
        ...cellProps(field, "header"),
        ...(measured !== undefined && { columnField: field }),
      }),
      bodyCell: (field) => cellProps(field, "body"),
      actionsHeaderStyle: active ? { zIndex: HEADER_Z_INDEX } : undefined,
    };
  }, [active, ordered, view, measured, hasExpandColumn, hasActionsColumn, fillsHeight]);
}
