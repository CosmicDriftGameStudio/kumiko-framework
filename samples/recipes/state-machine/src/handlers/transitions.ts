// All six state-change handlers in one place. Five of them follow the
// transitionHandler shape verbatim; mark-paid and update-status carry a
// little extra logic (amount-check, verb routing, dedicated forced-event)
// and stay inline so the variation is visible at the call site.

import {
  defineWriteHandler,
  emitEvent,
  guardTransition,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { INVOICE_STATES, INVOICE_TRANSITIONS } from "../entities/invoice";
import { ENTITY_NAME, type InvoiceEvents } from "../events";
import { type InvoiceStatus, loadInvoiceState } from "../reducer";
import { successResult, transitionHandler } from "./_helpers";

const adminOnly = { roles: ["Admin"] } as const;

export function createInvoiceTransitionHandlers(events: InvoiceEvents) {
  // --- Standard transitions (same shape, different target status) ---

  const invoiceSend = transitionHandler({
    name: "invoice:send",
    toStatus: "sent",
    event: events.sent,
    access: adminOnly,
  });

  const invoiceCancel = transitionHandler({
    name: "invoice:cancel",
    toStatus: "cancelled",
    event: events.cancelled,
    access: adminOnly,
  });

  const invoiceReopen = transitionHandler({
    name: "invoice:reopen",
    toStatus: "draft",
    event: events.reopened,
    access: adminOnly,
  });

  // --- markPaid: same shape + business rule (amount must be > 0).
  //     The amount is reduced from the event stream, so the check stays
  //     consistent with everything else (no out-of-band DB query).

  const invoiceMarkPaid = defineWriteHandler({
    name: "invoice:mark-paid",
    schema: z.object({ id: z.uuid() }),
    access: { roles: ["Accounting"] },
    handler: async (event, ctx) => {
      const state = await loadInvoiceState(ctx, event.payload.id);
      if (!state) return failNotFound(ENTITY_NAME, event.payload.id);

      guardTransition(INVOICE_TRANSITIONS, state.status as InvoiceStatus, "paid");

      if (state.amount === 0) {
        return failUnprocessable("cannot_pay_zero_amount");
      }

      await emitEvent(ctx, events.markedPaid, {
        aggregateId: event.payload.id,
        aggregateType: ENTITY_NAME,
        payload: {},
      });

      return successResult(event.payload.id, "paid", state.status);
    },
  });

  // --- updateStatus: relies on the pipeline's auto transition guard.
  //     Routes the requested status to the matching domain event so the audit
  //     log still reads as a workflow step ("invoice-sent"), not a generic
  //     "status set to ...".

  // `satisfies Record<InvoiceStatus, ...>` makes a missing status a compile error.
  const verbToEvent = {
    draft: events.reopened,
    sent: events.sent,
    paid: events.markedPaid,
    cancelled: events.cancelled,
  } satisfies Record<InvoiceStatus, InvoiceEvents["sent"]>;

  const invoiceUpdateStatus = defineWriteHandler({
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
      await emitEvent(ctx, verbToEvent[target], {
        aggregateId: event.payload.id,
        aggregateType: ENTITY_NAME,
        payload: {},
      });

      return successResult(event.payload.id, target, state.status);
    },
  });

  // --- forceStatus: skips the guard and emits a dedicated "forced" event so
  //     admin overrides stay visually distinct from normal workflow events in
  //     the audit log.

  const invoiceForceStatus = defineWriteHandler({
    name: "invoice:force-status",
    schema: z.object({
      id: z.uuid(),
      status: z.enum(INVOICE_STATES),
    }),
    access: adminOnly,
    unsafeSkipTransitionGuard: true,
    handler: async (event, ctx) => {
      const state = await loadInvoiceState(ctx, event.payload.id);
      if (!state) return failNotFound(ENTITY_NAME, event.payload.id);

      await emitEvent(ctx, events.statusForced, {
        aggregateId: event.payload.id,
        aggregateType: ENTITY_NAME,
        payload: { newStatus: event.payload.status, fromStatus: state.status as InvoiceStatus },
      });

      return successResult(event.payload.id, event.payload.status, state.status);
    },
  });

  return {
    invoiceSend,
    invoiceCancel,
    invoiceReopen,
    invoiceMarkPaid,
    invoiceUpdateStatus,
    invoiceForceStatus,
  };
}
