// All six state-change handlers in one place. Five of them follow the
// transitionHandler shape verbatim; mark-paid and update-status carry a
// little extra logic (amount-check, verb routing, dedicated forced-event)
// and stay inline so the variation is visible at the call site.

import { failNotFound, failUnprocessable } from "@kumiko/framework/errors";
import { z } from "zod";
import { defineWriteHandler, guardTransition } from "../../.kumiko/define";
import { INVOICE_STATES, INVOICE_TRANSITIONS } from "../entities/invoice";
import { ENTITY_NAME, eventName, INVOICE_EVENTS } from "../events";
import { type InvoiceStatus, loadInvoiceState } from "../reducer";
import { successResult, transitionHandler } from "./_helpers";

const adminOnly = { roles: ["Admin"] } as const;

// --- Standard transitions (same shape, different target status) ---

export const invoiceSend = transitionHandler({
  name: "invoice:send",
  toStatus: "sent",
  eventType: eventName(INVOICE_EVENTS.sent),
  access: adminOnly,
});

export const invoiceCancel = transitionHandler({
  name: "invoice:cancel",
  toStatus: "cancelled",
  eventType: eventName(INVOICE_EVENTS.cancelled),
  access: adminOnly,
});

export const invoiceReopen = transitionHandler({
  name: "invoice:reopen",
  toStatus: "draft",
  eventType: eventName(INVOICE_EVENTS.reopened),
  access: adminOnly,
});

// --- markPaid: same shape + business rule (amount must be > 0).
//     The amount is reduced from the event stream, so the check stays
//     consistent with everything else (no out-of-band DB query).

export const invoiceMarkPaid = defineWriteHandler({
  name: "invoice:mark-paid",
  schema: z.object({ id: z.uuid() }),
  access: { roles: ["Accounting"] },
  handler: async (event, ctx) => {
    const state = await loadInvoiceState(ctx, event.payload.id);
    if (!state) return failNotFound(ENTITY_NAME, event.payload.id);

    guardTransition(INVOICE_TRANSITIONS, state.status, "paid");

    if (state.amount === 0) {
      return failUnprocessable("cannot_pay_zero_amount");
    }

    await ctx.appendEvent({
      aggregateId: event.payload.id,
      aggregateType: ENTITY_NAME,
      type: eventName(INVOICE_EVENTS.markedPaid),
      payload: {},
    });

    return successResult(event.payload.id, "paid", state.status);
  },
});

// --- updateStatus: relies on the pipeline's auto transition guard.
//     Routes the requested status to the matching domain event so the audit
//     log still reads as a workflow step ("invoice-sent"), not a generic
//     "status set to ...".

// `as const satisfies` keeps the literal-strings alive (so each value is
// `"billing:event:invoice-..."` literally typed, not just `string`) AND
// type-checks the shape against `Record<InvoiceStatus, string>` —
// missing-status entries fail at compile-time. Strict-mode for
// ctx.appendEvent kicks in because `VERB_TO_EVENT[target]` resolves to
// a union of literal event-names, all of which are augmented keys.
const VERB_TO_EVENT = {
  draft: eventName(INVOICE_EVENTS.reopened),
  sent: eventName(INVOICE_EVENTS.sent),
  paid: eventName(INVOICE_EVENTS.markedPaid),
  cancelled: eventName(INVOICE_EVENTS.cancelled),
} as const satisfies Record<InvoiceStatus, string>;

export const invoiceUpdateStatus = defineWriteHandler({
  name: "invoice:update-status",
  schema: z.object({
    id: z.uuid(),
    changes: z.object({
      status: z.enum(INVOICE_STATES),
    }),
  }),
  access: adminOnly,
  // No skipTransitionGuard — pipeline auto-guards.
  handler: async (event, ctx) => {
    const state = await loadInvoiceState(ctx, event.payload.id);
    if (!state) return failNotFound(ENTITY_NAME, event.payload.id);

    const target = event.payload.changes.status;
    await ctx.appendEvent({
      aggregateId: event.payload.id,
      aggregateType: ENTITY_NAME,
      type: VERB_TO_EVENT[target],
      payload: {},
    });

    return successResult(event.payload.id, target, state.status);
  },
});

// --- forceStatus: skips the guard and emits a dedicated "forced" event so
//     admin overrides stay visually distinct from normal workflow events in
//     the audit log.

export const invoiceForceStatus = defineWriteHandler({
  name: "invoice:force-status",
  schema: z.object({
    id: z.uuid(),
    status: z.enum(INVOICE_STATES),
  }),
  access: adminOnly,
  skipTransitionGuard: true,
  handler: async (event, ctx) => {
    const state = await loadInvoiceState(ctx, event.payload.id);
    if (!state) return failNotFound(ENTITY_NAME, event.payload.id);

    await ctx.appendEvent({
      aggregateId: event.payload.id,
      aggregateType: ENTITY_NAME,
      type: eventName(INVOICE_EVENTS.statusForced),
      payload: { newStatus: event.payload.status, fromStatus: state.status },
    });

    return successResult(event.payload.id, event.payload.status, state.status);
  },
});
