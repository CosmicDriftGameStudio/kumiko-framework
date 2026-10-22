import { type KeyboardEvent, useState } from "react";
import type { DataTableViewOptions } from "../../../data-table-view-types.ts";
import { isKeyboardNavigationActive } from "./column-layout-mode.ts";

const KEYBOARD_ROW_ATTRIBUTE = "data-keyboard-row";
const FOCUS_RING_CLASS =
  "group/row focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

// Opaque sticky cells paint over the row outline, so they draw the top and bottom edge themselves.
export const ROW_FOCUS_RING_CELL_CLASS =
  "relative after:pointer-events-none after:absolute after:inset-0 after:border-y-2 after:border-transparent group-focus-visible/row:after:border-ring";

export type KeyboardRow = {
  readonly props: {
    readonly tabIndex?: number;
    readonly onFocus?: () => void;
    readonly onKeyDown?: (event: KeyboardEvent<HTMLTableRowElement>) => void;
    readonly [KEYBOARD_ROW_ATTRIBUTE]?: "";
  };
  readonly className: string | undefined;
};

const INACTIVE_ROW: KeyboardRow = { props: {}, className: undefined };

function keyboardRowsAround(row: HTMLElement): readonly HTMLElement[] {
  const siblings = Array.from(row.parentElement?.children ?? []);
  return siblings.filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute(KEYBOARD_ROW_ATTRIBUTE),
  );
}

function targetRow(event: KeyboardEvent<HTMLTableRowElement>): HTMLElement | undefined {
  const rows = keyboardRowsAround(event.currentTarget);
  const index = rows.indexOf(event.currentTarget);
  switch (event.key) {
    case "ArrowDown":
      return rows[Math.min(rows.length - 1, index + 1)];
    case "ArrowUp":
      return rows[Math.max(0, index - 1)];
    case "Home":
      return rows[0];
    case "End":
      return rows[rows.length - 1];
    default:
      return undefined;
  }
}

/** Roving tabindex over the data rows: one tab stop, arrows/Home/End move, Enter opens.
 *  Space stays free for row selection. Inactive: no attributes at all. */
export function useRowKeyboardNavigation({
  view,
  isNarrow,
  rowIds,
}: {
  readonly view: DataTableViewOptions | undefined;
  readonly isNarrow: boolean;
  readonly rowIds: readonly string[];
}): (rowId: string, open: (() => void) | undefined) => KeyboardRow {
  const active = isKeyboardNavigationActive(view, isNarrow);
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);
  const tabStopId = focusedId !== undefined && rowIds.includes(focusedId) ? focusedId : rowIds[0];
  if (!active) return () => INACTIVE_ROW;

  return (rowId, open) => ({
    props: {
      tabIndex: rowId === tabStopId ? 0 : -1,
      onFocus: () => setFocusedId(rowId),
      onKeyDown: (event) => {
        // skip: keys inside an editable cell, the first-cell link or a resize handle belong to that element
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" && open !== undefined) {
          event.preventDefault();
          open();
        } else {
          const target = targetRow(event);
          // skip: not a navigation key, or no row in that direction
          if (target === undefined) return;
          event.preventDefault();
          target.focus();
        }
      },
      [KEYBOARD_ROW_ATTRIBUTE]: "",
    },
    className: FOCUS_RING_CLASS,
  });
}
