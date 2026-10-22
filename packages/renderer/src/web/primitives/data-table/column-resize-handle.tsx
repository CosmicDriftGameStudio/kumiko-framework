import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { MAX_COLUMN_WIDTH_PX } from "../../../hooks/list-column-layout.ts";
import { useOptionalTranslation } from "../../../index.ts";
import { arrowKeyDelta, usePointerDrag } from "../../widgets/use-pointer-drag.ts";
import type { ColumnSizing } from "./use-column-sizing.ts";
import { EXPAND_COLUMN_WIDTH_PX, SELECT_COLUMN_WIDTH_PX } from "./use-measured-column-widths.ts";

export function ColumnWidthGroup({
  fields,
  sizing,
  hasExpandColumn,
  hasSelectColumn = false,
  hasActionsColumn,
}: {
  readonly fields: readonly string[];
  readonly sizing: ColumnSizing;
  readonly hasExpandColumn: boolean;
  readonly hasSelectColumn?: boolean;
  readonly hasActionsColumn: boolean;
}): ReactNode {
  return (
    <colgroup>
      {hasSelectColumn && <col style={{ width: SELECT_COLUMN_WIDTH_PX }} />}
      {hasExpandColumn && <col style={{ width: EXPAND_COLUMN_WIDTH_PX }} />}
      {fields.map((field) => (
        <col key={field} style={{ width: sizing.widthOf(field) }} />
      ))}
      {hasActionsColumn && <col />}
    </colgroup>
  );
}

// Visible while the header is hovered or the grip has focus; the wider 8px hit area stays transparent.
const HANDLE_CLASS =
  "absolute inset-y-0 right-0 z-10 m-0 h-full w-2 border-0 bg-transparent cursor-col-resize touch-none outline-none " +
  "after:absolute after:inset-y-1 after:right-0 after:w-0.5 after:rounded-full after:bg-transparent " +
  "group-hover/header:after:bg-border hover:after:bg-ring focus-visible:after:bg-ring active:after:bg-ring";

export function ColumnResizeHandle({
  field,
  label,
  sizing,
}: {
  readonly field: string;
  readonly label: string;
  readonly sizing: ColumnSizing;
}): ReactNode {
  const translate = useOptionalTranslation();
  const width = sizing.widthOf(field);
  const minWidth = sizing.minWidthOf(field);
  const draggedWidth = useRef<number | null>(null);
  const clampToBounds = (value: number): number =>
    Math.min(MAX_COLUMN_WIDTH_PX, Math.max(minWidth, value));
  const drag = usePointerDrag({
    onStart: () => width,
    onMove: (startWidth, { dx }) => {
      const next = clampToBounds(startWidth + dx);
      draggedWidth.current = next;
      sizing.setLiveWidth(field, next);
    },
    onEnd: () => {
      const final = draggedWidth.current;
      draggedWidth.current = null;
      if (final !== null) sizing.commit(field, final);
    },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    event.stopPropagation();
    const delta = arrowKeyDelta(event);
    if (delta === undefined || delta.dx === 0) return;
    event.preventDefault();
    sizing.commit(field, clampToBounds(width + delta.dx));
  };

  return (
    <hr
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      aria-valuemin={minWidth}
      aria-valuemax={MAX_COLUMN_WIDTH_PX}
      aria-label={translate?.("kumiko.list.column.resize", { column: label }) ?? `Resize ${label}`}
      tabIndex={0}
      data-testid={`column-resize-${field}`}
      className={HANDLE_CLASS}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
      {...drag}
      onPointerDown={(event) => {
        event.stopPropagation();
        drag.onPointerDown(event);
      }}
    />
  );
}
