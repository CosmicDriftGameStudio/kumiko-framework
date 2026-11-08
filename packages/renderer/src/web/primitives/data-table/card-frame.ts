import type { DataTableModel } from "./use-data-table-state.ts";

type FrameInput = Pick<DataTableModel, "frame" | "belowSm">;

/** `frame: "card"` from sm: one bordered card around table or card list, summary row and pager. */
export function isInsideCardFrame(m: FrameInput): boolean {
  return m.frame === "card" && !m.belowSm;
}

/** `frame: "card"` below sm: every card of the card layout is bordered and rounded, with a gap. */
export function hasSeparateCardRows(m: FrameInput): boolean {
  return m.frame === "card" && m.belowSm;
}

export const CARD_SURFACE_CLASS = "rounded-lg border border-border bg-card";

// The row the assistant sees: light primary wash plus a 3px primary bar on the left edge.
export const ASSISTANT_FOCUS_CARD_CLASS =
  "bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary)]";
export const ASSISTANT_FOCUS_ROW_CLASS =
  "bg-primary/10 hover:bg-primary/10 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-primary)]";
