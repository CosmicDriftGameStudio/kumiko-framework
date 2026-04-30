// Reducer that derives invoice state from the event stream.
//
// Tracks `status` (used by transition guards + reported back in the
// WriteResult) and `amount` (used by the mark-paid business rule).
//
// Adding a new state field? Extend InvoiceState, set it in `initialInvoiceState`,
// and update the relevant `case` in `reduceInvoice` — that's the whole
// contract.

import type { HandlerContext } from "@app/define";
import { eventName, INVOICE_CREATED_EVENT, INVOICE_EVENTS } from "./events";

export type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled";
export type InvoiceState = {
  status: InvoiceStatus | "missing";
  amount: number;
};

export const initialInvoiceState: InvoiceState = { status: "missing", amount: 0 };

export function reduceInvoice(state: InvoiceState, evt: { type: string; payload?: unknown }): void {
  if (evt.type === INVOICE_CREATED_EVENT) {
    const payload = evt.payload as { amount?: number };
    state.status = "draft";
    state.amount = payload.amount ?? 0;
  } else if (evt.type === eventName(INVOICE_EVENTS.sent)) {
    state.status = "sent";
  } else if (evt.type === eventName(INVOICE_EVENTS.markedPaid)) {
    state.status = "paid";
  } else if (evt.type === eventName(INVOICE_EVENTS.cancelled)) {
    state.status = "cancelled";
  } else if (evt.type === eventName(INVOICE_EVENTS.reopened)) {
    state.status = "draft";
  } else if (evt.type === eventName(INVOICE_EVENTS.statusForced)) {
    const payload = evt.payload as { newStatus: InvoiceStatus };
    state.status = payload.newStatus;
  }
}

export async function loadInvoiceState(
  ctx: HandlerContext,
  id: string,
): Promise<InvoiceState | null> {
  const events = await ctx.loadAggregate(id);
  if (events.length === 0) return null;
  const state: InvoiceState = { ...initialInvoiceState };
  for (const evt of events) reduceInvoice(state, evt);
  if (state.status === "missing") return null;
  return state;
}
