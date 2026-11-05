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
