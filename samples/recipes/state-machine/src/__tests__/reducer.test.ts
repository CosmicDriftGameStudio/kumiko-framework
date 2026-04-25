import { describe, expect, test } from "vitest";
import { eventName, INVOICE_CREATED_EVENT, INVOICE_EVENTS } from "../events";
import { type InvoiceState, initialInvoiceState, reduceInvoice } from "../reducer";

function reduce(...events: { type: string; payload?: unknown }[]): InvoiceState {
  const state: InvoiceState = { ...initialInvoiceState };
  for (const evt of events) reduceInvoice(state, evt);
  return state;
}

describe("reduceInvoice", () => {
  test("initial state is missing + amount 0", () => {
    expect(initialInvoiceState).toEqual({ status: "missing", amount: 0 });
  });

  test("invoice.created sets status=draft and copies amount from payload", () => {
    const state = reduce({ type: INVOICE_CREATED_EVENT, payload: { amount: 250 } });
    expect(state.status).toBe("draft");
    expect(state.amount).toBe(250);
  });

  test("invoice.created without amount in payload defaults amount to 0", () => {
    const state = reduce({ type: INVOICE_CREATED_EVENT, payload: {} });
    expect(state.status).toBe("draft");
    expect(state.amount).toBe(0);
  });

  test("invoice-sent moves status to sent", () => {
    const state = reduce(
      { type: INVOICE_CREATED_EVENT, payload: { amount: 100 } },
      { type: eventName(INVOICE_EVENTS.sent) },
    );
    expect(state.status).toBe("sent");
  });

  test("invoice-marked-paid moves status to paid", () => {
    const state = reduce(
      { type: INVOICE_CREATED_EVENT, payload: { amount: 100 } },
      { type: eventName(INVOICE_EVENTS.sent) },
      { type: eventName(INVOICE_EVENTS.markedPaid) },
    );
    expect(state.status).toBe("paid");
  });

  test("invoice-cancelled moves status to cancelled", () => {
    const state = reduce(
      { type: INVOICE_CREATED_EVENT, payload: { amount: 100 } },
      { type: eventName(INVOICE_EVENTS.sent) },
      { type: eventName(INVOICE_EVENTS.cancelled) },
    );
    expect(state.status).toBe("cancelled");
  });

  test("invoice-reopened moves status back to draft", () => {
    const state = reduce(
      { type: INVOICE_CREATED_EVENT, payload: { amount: 100 } },
      { type: eventName(INVOICE_EVENTS.sent) },
      { type: eventName(INVOICE_EVENTS.cancelled) },
      { type: eventName(INVOICE_EVENTS.reopened) },
    );
    expect(state.status).toBe("draft");
  });

  test("invoice-status-forced applies the newStatus from payload", () => {
    const state = reduce(
      { type: INVOICE_CREATED_EVENT, payload: { amount: 100 } },
      { type: eventName(INVOICE_EVENTS.statusForced), payload: { newStatus: "paid" } },
    );
    expect(state.status).toBe("paid");
  });

  test("amount stays after status transitions (only created mutates amount)", () => {
    const state = reduce(
      { type: INVOICE_CREATED_EVENT, payload: { amount: 999 } },
      { type: eventName(INVOICE_EVENTS.sent) },
      { type: eventName(INVOICE_EVENTS.cancelled) },
    );
    expect(state.amount).toBe(999);
  });

  test("unknown event types are ignored, state stays untouched", () => {
    const state = reduce(
      { type: INVOICE_CREATED_EVENT, payload: { amount: 100 } },
      { type: "some-other-feature:event:nonsense", payload: { ignored: true } },
    );
    expect(state.status).toBe("draft");
    expect(state.amount).toBe(100);
  });
});
