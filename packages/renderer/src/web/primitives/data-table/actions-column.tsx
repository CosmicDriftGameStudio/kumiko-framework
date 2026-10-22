import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { TableCell, TableHead } from "../../ui/table.tsx";
import { ROW_FOCUS_RING_CELL_CLASS } from "./use-row-keyboard-navigation.ts";

export const ACTIONS_CONTENT_ATTRIBUTE = "data-actions-content";

export function stickyActionsCellClass(fillsHeight: boolean): string {
  return cn("md:sticky md:right-0 md:z-10 md:bg-background", fillsHeight && "md:bg-card");
}

export function ActionsHeaderCell({
  label,
  style,
  absorbsLeftover,
}: {
  readonly label: string;
  readonly style?: CSSProperties | undefined;
  /** Fixed table layout: `w-px` would pin this column to 1px, so it must size as auto and take the leftover width. */
  readonly absorbsLeftover: boolean;
}): ReactNode {
  return (
    <TableHead
      data-testid="column-actions"
      // From md: sticky right-0 + bg-muted (= header tone) so the
      // action column stays at the right edge during horizontal
      // scroll on wider screens. Below md, actions scroll in
      // normal flow — sticky there would pin the column over the
      // preceding data column instead of the (already narrow)
      // page edge. No border-l: a permanent divider looks heavy;
      // the sticky bg already sets the column apart during scroll.
      className="w-px text-right text-muted-foreground md:sticky md:right-0 md:z-10 md:bg-muted"
      aria-label={label}
      style={absorbsLeftover ? { ...style, width: "auto" } : style}
    />
  );
}

export function ActionsBodyCell({
  testId,
  fillsHeight,
  measureContent,
  children,
}: {
  readonly testId: string;
  readonly fillsHeight: boolean;
  /** Wraps the content so the column's natural width stays measurable under a fixed table layout. */
  readonly measureContent: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <TableCell
      data-testid={testId}
      // From md: sticky-right so the actions stay visible on the
      // right edge during horizontal scroll. Below md, actions
      // scroll with the row like any other cell — sticky there
      // would hide the neighboring data column on narrow
      // viewports. bg-background sets the column apart during
      // scroll — no border-l (divider too heavy).
      className={cn(
        "whitespace-nowrap text-right",
        stickyActionsCellClass(fillsHeight),
        ROW_FOCUS_RING_CELL_CLASS,
      )}
      // Action-cell events must not trigger the row click/activation
      // (typically "Open Detail" — the user wanted the action,
      // not navigation). We stopPropagation for mouse and
      // keyboard so a11y stays consistent.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {measureContent ? (
        <div {...{ [ACTIONS_CONTENT_ATTRIBUTE]: "" }} className="ml-auto w-max">
          {children}
        </div>
      ) : (
        children
      )}
    </TableCell>
  );
}
