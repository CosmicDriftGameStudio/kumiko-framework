// State Machine Sample
// Shows: defineTransitions, guardTransition (manual + auto), state machine via
// event-sourced status changes. Each transition is its own domain event so the
// audit log reads like the workflow ("invoice-sent", "invoice-cancelled"), not
// like a SQL changelog ("status updated to sent").
//
// Workflow:
//   draft → sent → paid       (happy path)
//                 → cancelled  (abort)
//   cancelled → draft          (reopen)
//
// Roles:
//   Admin      — create, send, cancel, reopen, updateStatus, forceStatus
//   Accounting — markPaid
//
// Files:
//   entities/invoice.ts       — entity + table + transition config
//   events.ts                 — single source of truth for event names
//   reducer.ts                — derives status + amount from the event stream
//   handlers/_helpers.ts      — shared transitionHandler + successResult
//   handlers/create.ts        — invoice:create (uses executor)
//   handlers/transitions.ts   — the six state-change handlers

import { defineFeature, setFields } from "@app/define";
import { z } from "zod";
import { invoiceEntity, invoiceTable } from "./entities/invoice";
import { eventName, INVOICE_EVENTS } from "./events";
import { invoiceCreate } from "./handlers/create";
import {
  invoiceCancel,
  invoiceForceStatus,
  invoiceMarkPaid,
  invoiceReopen,
  invoiceSend,
  invoiceUpdateStatus,
} from "./handlers/transitions";
import type { InvoiceStatus } from "./reducer";

export { invoiceEntity } from "./entities/invoice";

export const stateMachineFeature = defineFeature("billing", (r) => {
  r.entity("invoice", invoiceEntity);

  // Domain events — one per intent. Names live in events.ts so the reducer
  // and the projection stay in sync. The auto "invoice.created" event from
  // the executor's create-path covers the initial insert, so we only declare
  // the state-change events here.
  r.defineEvent(INVOICE_EVENTS.sent, z.object({}));
  r.defineEvent(INVOICE_EVENTS.markedPaid, z.object({}));
  r.defineEvent(INVOICE_EVENTS.cancelled, z.object({}));
  r.defineEvent(INVOICE_EVENTS.reopened, z.object({}));
  r.defineEvent(
    INVOICE_EVENTS.statusForced,
    z.object({
      newStatus: z.enum(["draft", "sent", "paid", "cancelled"]),
      fromStatus: z.enum(["draft", "sent", "paid", "cancelled"]),
    }),
  );

  // The aggregate table (sample_sm_invoices) is INSERTed by the executor on
  // invoice:create. State-change events update the same row via this inline
  // projection — keeps reads consistent with writes inside the same TX.
  // setFields collapses "UPDATE <table> SET <cols> WHERE id = aggregateId"
  // into a one-liner. Pass a literal for fixed-target events, a reducer fn
  // for events that carry the new value in their payload.
  r.projection({
    name: "invoice-status",
    source: "invoice",
    table: invoiceTable,
    apply: {
      [eventName(INVOICE_EVENTS.sent)]: setFields(invoiceTable, { status: "sent" }),
      [eventName(INVOICE_EVENTS.markedPaid)]: setFields(invoiceTable, { status: "paid" }),
      [eventName(INVOICE_EVENTS.cancelled)]: setFields(invoiceTable, { status: "cancelled" }),
      [eventName(INVOICE_EVENTS.reopened)]: setFields(invoiceTable, { status: "draft" }),
      [eventName(INVOICE_EVENTS.statusForced)]: setFields(invoiceTable, (e) => ({
        status: (e.payload as { newStatus: InvoiceStatus }).newStatus,
      })),
    },
  });

  r.writeHandler(invoiceCreate);
  r.writeHandler(invoiceSend);
  r.writeHandler(invoiceMarkPaid);
  r.writeHandler(invoiceCancel);
  r.writeHandler(invoiceReopen);
  r.writeHandler(invoiceUpdateStatus);
  r.writeHandler(invoiceForceStatus);
});
