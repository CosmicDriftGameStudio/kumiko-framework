// Event Sourcing Showcase
//
// Production-pattern sample that exercises every Sprint-E Marten gold-
// standard API in one place:
//
//   - r.defineEvent with { version, migrations } — evolving event shapes +
//     upcast older payloads on read (declarative + sync/async transforms)
//   - emitEvent — write domain events onto the aggregate stream, payload typed by the EventDef
//   - emitEvent with headers — Marten free key/value metadata
//   - r.projection — single-stream read model (inline in the write TX)
//   - r.multiStreamProjection — cross-aggregate async read model
//   - ctx.events.load with { asOf } — point-in-time aggregate state
//   - ctx.events.loadByTypes — events of many aggregates, filtered by type, in one query
//   - ctx.events.archive / ctx.events.restore — Marten ArchiveStream
//   - ctx.dispatch.queryProjection — tenant-scoped read of a projection table
//   - ctx.events.snapshot + ctx.events.loadWithSnapshot — perf path
//     for aggregates with long event tails (O(1) vs O(N) reduce), incl.
//     the auto-snapshot policy ({ snapshotEvery, snapshotVersion })
//   - streamAllEventsByType — memory-bounded iteration for ops/export jobs

import {
  fetchOne,
  incrementCounter,
  insertOne,
  updateMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  defineProjectionQueryHandler,
  typedPayload,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { createInvoiceAcknowledgeWrite } from "./handlers/invoice-acknowledge.write";
import { createInvoiceApproveWrite } from "./handlers/invoice-approve.write";
import { invoiceArchiveWrite } from "./handlers/invoice-archive.write";
import { invoiceCreateWrite } from "./handlers/invoice-create.write";
import { invoiceFastStateQuery } from "./handlers/invoice-fast-state.query";
import { createInvoicePayWrite } from "./handlers/invoice-pay.write";
import { createInvoicePaymentStatusesQuery } from "./handlers/invoice-payment-statuses.query";
import { invoiceStateQuery } from "./handlers/invoice-state.query";
import { invoiceStreamVersionQuery } from "./handlers/invoice-stream-version.query";
import { invoiceTakeSnapshotWrite } from "./handlers/invoice-take-snapshot.write";
import { opsSlowExportQuery } from "./handlers/ops-slow-export.query";
import {
  approverDirectoryTable,
  customerRevenueTable,
  invoiceDetailTable,
  invoiceEntity,
} from "./schema";

// --- Feature ---

export const invoiceFeature = defineFeature("showcase", (r) => {
  r.entity({ name: "showcase-invoice", ...invoiceEntity });

  // Two domain events. "approved" is versioned — v1 stored `amount` as
  // string, v2 uses `amountCents` integer. The DECLARATIVE migration form
  // covers rename/default/map without an imperative function; the chain
  // walks the upcast on read.
  const approved = r.defineEvent(
    "invoice-approved",
    z.object({ amountCents: z.number().int(), approvedBy: z.string() }),
    {
      piiFields: "none",
      version: 2,
      migrations: [
        {
          fromVersion: 1,
          toVersion: 2,
          transform: {
            rename: { amount: "amountCents" },
            map: { amountCents: (v) => Math.round(Number.parseFloat(String(v)) * 100) },
          },
        },
      ],
    },
  );

  const paid = r.defineEvent("invoice-paid", z.object({ amountCents: z.number().int() }), {
    piiFields: "none",
  });

  // Acknowledged event with an ASYNC upcaster: v1 had only the approverId,
  // v2 carries the human-readable display name too. The migration looks the
  // name up from the directory table at read time. This is Marten's
  // AsyncOnlyEventUpcaster pattern — DB enrichment without rewriting the
  // event log.
  const acknowledged = r.defineEvent(
    "invoice-acknowledged",
    z.object({ approverId: z.string(), approverDisplayName: z.string() }),
    {
      piiFields: { approverDisplayName: { personal: { of: "approverId" } } },
      version: 2,
      migrations: [
        {
          fromVersion: 1,
          toVersion: 2,
          transform: async (payload, ctx) => {
            const p = payload as { approverId: string };
            const row = await fetchOne<{ displayName: string }>(ctx.db, approverDirectoryTable, {
              approverId: p.approverId,
            });
            return {
              approverId: p.approverId,
              approverDisplayName: row?.displayName ?? `unknown:${p.approverId}`,
            };
          },
        },
      ],
    },
  );

  // Single-stream projection: one row per invoice, reacts to the auto
  // CRUD event + both domain events. Runs INLINE in the write TX.
  r.projection({
    name: "invoice-detail",
    source: "showcase-invoice",
    table: invoiceDetailTable,
    apply: {
      "showcase-invoice.created": async (event, tx) => {
        const p = event.payload as { customer: string; status: string };
        await insertOne(tx, invoiceDetailTable, {
          invoiceId: event.aggregateId,
          tenantId: event.tenantId,
          customer: p.customer,
          status: p.status,
          amountCents: 0,
        });
      },
      [approved.name]: async (event, tx) => {
        const p = typedPayload(event, approved);
        await updateMany(
          tx,
          invoiceDetailTable,
          { status: "approved", amountCents: p.amountCents },
          { invoiceId: event.aggregateId },
        );
      },
      [paid.name]: async (event, tx) => {
        await updateMany(
          tx,
          invoiceDetailTable,
          { status: "paid" },
          { invoiceId: event.aggregateId },
        );
      },
    },
  });

  // Multi-stream projection: one row per customer. Fires ASYNC via the
  // event-dispatcher (runOnce in tests, NOTIFY/LISTEN in production).
  r.multiStreamProjection({
    name: "customer-revenue",
    table: customerRevenueTable,
    apply: {
      [paid.name]: async (event, tx) => {
        // Resolve the customer: pull it from the invoice-detail projection
        // that the inline projection just populated. Cross-projection reads
        // are fine inside apply() — we're at the read model layer.
        const detail = await fetchOne<{ customer: string }>(tx, invoiceDetailTable, {
          invoiceId: event.aggregateId,
        });
        if (!detail) return;
        const p = typedPayload(event, paid);
        await incrementCounter(
          tx,
          customerRevenueTable,
          {
            customer: detail.customer,
            tenantId: event.tenantId,
            paidInvoices: 1,
            totalCents: p.amountCents,
          },
          { paidInvoices: 1, totalCents: p.amountCents },
          { conflictKeys: ["customer"] },
        );
      },
    },
  });

  r.writeHandler(invoiceCreateWrite);
  r.writeHandler(createInvoiceApproveWrite(approved));
  r.writeHandler(createInvoiceAcknowledgeWrite(acknowledged));
  r.writeHandler(createInvoicePayWrite(paid));
  r.writeHandler(invoiceArchiveWrite);
  r.writeHandler(invoiceTakeSnapshotWrite);

  r.queryHandler(invoiceStateQuery);
  r.queryHandler(invoiceStreamVersionQuery);
  r.queryHandler(createInvoicePaymentStatusesQuery({ approved: approved.name, paid: paid.name }));
  r.queryHandler(invoiceFastStateQuery);

  // Read-model query via ctx.dispatch.queryProjection — auto-tenant-scoped. The
  // helper collapses the zero-argument "return this projection" pattern
  // into a single call; returns { rows } so the response shape stays
  // consistent with other list handlers.
  r.queryHandler(
    defineProjectionQueryHandler("revenue:list", "showcase:projection:customer-revenue", {
      access: {
        openToAll: {
          reason:
            "demo recipe: any signed-in user may read the customer-revenue projection; " +
            "there is no per-user restriction in this sample",
        },
      },
    }),
  );

  r.queryHandler(opsSlowExportQuery);
});
