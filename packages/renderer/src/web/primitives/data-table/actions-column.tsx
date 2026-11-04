import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { TableCell, TableHead } from "../../ui/table.tsx";
import { COLUMN_ROLE_ATTRIBUTE } from "./column-role.ts";
import { ROW_FOCUS_RING_CELL_CLASS } from "./use-row-keyboard-navigation.ts";
import "../../react-css-custom-properties.ts";

export const ACTIONS_CONTENT_ATTRIBUTE = "data-actions-content";

const ROW_TONE_COLOR: Readonly<Record<SelectOptionTone, string | undefined>> = {
  bad: "var(--color-status-bad)",
  warn: "var(--color-status-warn)",
  ok: "var(--color-status-ok)",
  critical: "var(--color-status-critical)",
  accent: "var(--color-primary)",
  neutral: undefined,
};

// The sticky cell stays opaque because other cells scroll under it, so a toned row's translucent
// tint (`rowToneClass`, 10 %, 15 % on hover) is mixed into the surface here instead of being
// painted twice; the tone color arrives as `--row-tone` from `rowToneCellStyle`.
const TONED_STICKY_CELL_CLASS = {
  background:
    "md:bg-[color-mix(in_srgb,var(--row-tone)_10%,var(--color-background))] md:[tr:hover>&]:bg-[color-mix(in_srgb,var(--row-tone)_15%,var(--color-background))]",
  card: "md:bg-[color-mix(in_srgb,var(--row-tone)_10%,var(--color-card))] md:[tr:hover>&]:bg-[color-mix(in_srgb,var(--row-tone)_15%,var(--color-card))]",
} as const;

function isTinted(rowTone: SelectOptionTone | undefined): boolean {
  return rowTone !== undefined && ROW_TONE_COLOR[rowTone] !== undefined;
}

export function stickyActionsCellClass(
  fillsHeight: boolean,
  rowTone?: SelectOptionTone | undefined,
): string {
  const tinted = isTinted(rowTone);
  return cn(
    "md:sticky md:right-0 md:z-10",
    fillsHeight
      ? tinted
        ? TONED_STICKY_CELL_CLASS.card
        : "md:bg-card"
      : tinted
        ? TONED_STICKY_CELL_CLASS.background
        : "md:bg-background",
  );
}

export function rowToneCellStyle(rowTone: SelectOptionTone | undefined): CSSProperties | undefined {
  const color = rowTone === undefined ? undefined : ROW_TONE_COLOR[rowTone];
  return color === undefined ? undefined : { "--row-tone": color };
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
      {...{ [COLUMN_ROLE_ATTRIBUTE]: "actions" }}
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
  rowTone,
  measureContent,
  children,
}: {
  readonly testId: string;
  readonly fillsHeight: boolean;
  readonly rowTone: SelectOptionTone | undefined;
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
        stickyActionsCellClass(fillsHeight, rowTone),
        ROW_FOCUS_RING_CELL_CLASS,
      )}
      style={rowToneCellStyle(rowTone)}
      // Only under column sizing is the empty cell leftover width that belongs to the row;
      // otherwise it is padding around the buttons, where a misclick must not open the row.
      onClick={(e) => {
        if (!measureContent || e.target !== e.currentTarget) e.stopPropagation();
      }}
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
