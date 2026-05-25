// Event Sourcing Showcase
//
// Production-pattern sample that exercises every Sprint-E Marten gold-
// standard API in one place:
//
//   - r.defineEvent with { version } — declare evolving event shapes
//   - r.eventMigration — upcast older payloads on read (sync + async)
//   - ctx.appendEvent — write domain events onto the aggregate stream
//   - ctx.appendEvent with headers — Marten free key/value metadata
//   - r.projection — single-stream read model (inline in the write TX)
//   - r.multiStreamProjection — cross-aggregate async read model
//   - ctx.loadAggregate with { asOf } — point-in-time aggregate state
//   - ctx.archiveStream / ctx.restoreStream — Marten ArchiveStream
//   - ctx.queryProjection — tenant-scoped read of a projection table
//   - ctx.snapshotAggregate + ctx.loadAggregateWithSnapshot — perf path
//     for aggregates with long event tails (O(1) vs O(N) reduce)
//   - streamAllEventsByType — memory-bounded iteration for ops/export jobs
//   - getAllProjectionProgress — projection lag for ops dashboards

import {
  createEntity,
  createTextField,
  defineFeature,
  defineProjectionQueryHandler,
  typedPayload,
} from "@app/define";
import { fetchOne, incrementCounter, insertOne, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  integer,
  table,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import { sql } from "@cosmicdrift/kumiko-framework/db";
import { z } from "zod";

// --- Reducer: shared by live + snapshot-aware query handlers ---

type InvoiceState = {
  id: string | null;
  customer: string | null;
  status: string;
  amountCents: number;
  approvedBy: string | null;
  paid: boolean;
};

// Record<string,unknown>-compatible alias — the snapshot reducer generic
// constrains state to that shape, so we hand it this view instead of the
// narrower InvoiceState to satisfy the bound without changing semantics.
type InvoiceStateRecord = Record<string, unknown> & InvoiceState;

const initialInvoiceState: InvoiceState = {
  id: null,
  customer: null,
  status: "missing",
  amountCents: 0,
  approvedBy: null,
  paid: false,
};

function reduceInvoice(state: InvoiceState, evt: { type: string; payload: unknown }): void {
  if (evt.type === "showcase-invoice.created") {
    const p = evt.payload as { id: string; customer: string; status: string };
    state.id = p.id;
    state.customer = p.customer;
    state.status = p.status;
  } else if (evt.type.endsWith(":event:invoice-approved")) {
    const p = evt.payload as { amountCents: number; approvedBy: string };
    state.status = "approved";
    state.amountCents = p.amountCents;
    state.approvedBy = p.approvedBy;
  } else if (evt.type.endsWith(":event:invoice-paid")) {
    state.status = "paid";
    state.paid = true;
  }
}

// --- Aggregate entity: invoice, stored as events only ---

export const invoiceEntity = createEntity({
  table: "read_showcase_invoices",
  fields: {
    customer: createTextField({ required: true }),
    status: createTextField({ required: true }), // "draft" | "approved" | "paid" | "closed"
  },
});

const invoiceTable = buildEntityTable("showcase-invoice", invoiceEntity);

// --- Projection 1: per-invoice detail (single-stream, inline) ---

export const invoiceDetailTable = table("read_showcase_invoice_detail", {
  invoiceId: uuid("invoice_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  customer: text("customer").notNull(),
  status: text("status").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
});

// --- Projection 2: per-customer revenue (multi-stream, async) ---

export const customerRevenueTable = table("read_showcase_customer_revenue", {
  customer: text("customer").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  paidInvoices: integer("paid_invoices").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
});

// --- Reference data: approver display-name directory ---
// The async upcaster (invoice-acknowledged v1 → v2) reads from this table
// to enrich legacy events with a human-readable name. In production this
// would be a domain-owned read model; here it's a flat lookup table.
export const approverDirectoryTable = table("read_showcase_approver_directory", {
  approverId: text("approver_id").primaryKey(),
  displayName: text("display_name").notNull(),
});

// --- Feature ---

export const invoiceFeature = defineFeature("showcase", (r) => {
  r.entity("showcase-invoice", invoiceEntity);

  // Two domain events. "approved" is versioned — v1 stored `amount` as
  // string, v2 uses `amountCents` integer. The migration chain walks
  // the upcast on read.
  const approved = r.defineEvent(
    "invoice-approved",
    z.object({ amountCents: z.number().int(), approvedBy: z.string() }),
    { version: 2 },
  );
  r.eventMigration("invoice-approved", 1, 2, (payload) => {
    const p = payload as { amount: string; approvedBy: string };
    return {
      amountCents: Math.round(Number.parseFloat(p.amount) * 100),
      approvedBy: p.approvedBy,
    };
  });

  const paid = r.defineEvent("invoice-paid", z.object({ amountCents: z.number().int() }));

  // Acknowledged event with an ASYNC upcaster: v1 had only the approverId,
  // v2 carries the human-readable display name too. The migration looks the
  // name up from the directory table at read time. This is Marten's
  // AsyncOnlyEventUpcaster pattern — DB enrichment without rewriting the
  // event log.
  const acknowledged = r.defineEvent(
    "invoice-acknowledged",
    z.object({ approverId: z.string(), approverDisplayName: z.string() }),
    { version: 2 },
  );
  r.eventMigration("invoice-acknowledged", 1, 2, async (payload, ctx) => {
    const p = payload as { approverId: string };
    const row = await fetchOne<{ displayName: string }>(ctx.db, approverDirectoryTable, {
      approverId: p.approverId,
    });
    return {
      approverId: p.approverId,
      approverDisplayName: row?.displayName ?? `unknown:${p.approverId}`,
    };
  });

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
        await updateMany(tx, invoiceDetailTable, { status: "paid" }, { invoiceId: event.aggregateId });
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

  const invoiceExecutor = createEventStoreExecutor(invoiceTable, invoiceEntity, {
    entityName: "showcase-invoice",
  });

  // --- Write handlers ---

  r.writeHandler(
    "invoice:create",
    z.object({ customer: z.string() }),
    async (event, ctx) =>
      invoiceExecutor.create(
        { customer: event.payload.customer, status: "draft" },
        event.user,
        ctx.db,
      ),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "invoice:approve",
    z.object({
      id: z.uuid(),
      amountCents: z.number().int(),
      approvedBy: z.string(),
      // Optional ops metadata that the caller wants threaded into the
      // event for later filtering/auditing without bloating the payload.
      geoRegion: z.string().optional(),
      abTestBucket: z.string().optional(),
    }),
    async (event, ctx) => {
      const headers: Record<string, string> = {};
      if (event.payload.geoRegion) headers["geoRegion"] = event.payload.geoRegion;
      if (event.payload.abTestBucket) headers["abTestBucket"] = event.payload.abTestBucket;
      await ctx.appendEvent({
        aggregateId: event.payload.id,
        aggregateType: "showcase-invoice",
        type: approved.name,
        payload: { amountCents: event.payload.amountCents, approvedBy: event.payload.approvedBy },
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "invoice:acknowledge",
    z.object({ id: z.uuid(), approverId: z.string() }),
    async (event, ctx) => {
      const row = await fetchOne<{ displayName: string }>(ctx.db, approverDirectoryTable, {
        approverId: event.payload.approverId,
      });
      const approverDisplayName: string = row?.displayName ?? `unknown:${event.payload.approverId}`;
      await ctx.appendEvent({
        aggregateId: event.payload.id,
        aggregateType: "showcase-invoice",
        type: acknowledged.name,
        payload: { approverId: event.payload.approverId, approverDisplayName },
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "invoice:pay",
    z.object({ id: z.uuid(), amountCents: z.number().int() }),
    async (event, ctx) => {
      await ctx.appendEvent({
        aggregateId: event.payload.id,
        aggregateType: "showcase-invoice",
        type: paid.name,
        payload: { amountCents: event.payload.amountCents },
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    {
      access: { roles: ["Admin"] },
      // Per-user cap: a single admin shouldn't fire more than 5 pay
      // operations per minute. Real production caps would be per
      // tenant + handler ("tenant+handler") to keep one admin from
      // monopolising the tenant's quota — kept simple here for the
      // sample. Demonstrates the fourth dispatcher gate (rate-limit
      // → access → validation → handler).
      rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
    },
  );

  r.writeHandler(
    "invoice:archive",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      await ctx.archiveStream(event.payload.id, { aggregateType: "showcase-invoice" });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

  // Persist a snapshot of the current state. In practice, features schedule
  // this from a lifecycle hook (every N events, every M minutes) — here it's
  // an explicit write-handler so the integration test can drive it.
  r.writeHandler(
    "invoice:take-snapshot",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      // Rebuild the state from the current stream so the snapshot reflects
      // the committed event log, not an in-memory guess. Use the upcaster-
      // aware ctx.loadAggregate to stay consistent with read-time semantics.
      const events = await ctx.loadAggregate(event.payload.id);
      const state: InvoiceState = { ...initialInvoiceState };
      for (const evt of events) {
        reduceInvoice(state, evt);
      }
      const version = events.length > 0 ? (events[events.length - 1]?.version ?? 0) : 0;
      await ctx.snapshotAggregate({
        aggregateId: event.payload.id,
        aggregateType: "showcase-invoice",
        version,
        state: state as unknown as Record<string, unknown>,
      });
      return { isSuccess: true as const, data: { id: event.payload.id, snapshotVersion: version } };
    },
    { access: { roles: ["Admin"] } },
  );

  // --- Query handlers ---

  // Live aggregation via ctx.loadAggregate — reduces events into a state
  // snapshot. Supports asOf for point-in-time reads.
  r.queryHandler(
    "invoice:state",
    z.object({ id: z.uuid(), asOf: z.iso.datetime().optional() }),
    async (query, ctx) => {
      const events = await ctx.loadAggregate(query.payload.id, {
        ...(query.payload.asOf ? { asOf: Temporal.Instant.from(query.payload.asOf) } : {}),
      });
      const state: InvoiceState = { ...initialInvoiceState };
      for (const evt of events) {
        reduceInvoice(state, evt);
      }
      return state;
    },
    { access: { openToAll: true } },
  );

  // Snapshot-aware fast path. Uses the latest snapshot if available and
  // only replays delta events past it. Identical state shape to
  // invoice:state — the two are interchangeable modulo the perf profile.
  r.queryHandler(
    "invoice:fast-state",
    z.object({ id: z.uuid() }),
    async (query, ctx) => {
      const result = await ctx.loadAggregateWithSnapshot<InvoiceStateRecord>(
        query.payload.id,
        (state, evt) => {
          const next: InvoiceStateRecord = { ...state };
          reduceInvoice(next as unknown as InvoiceState, evt);
          return next;
        },
        { ...initialInvoiceState } as InvoiceStateRecord,
      );
      return {
        state: result.state,
        version: result.version,
        snapshotHit: result.snapshotHit,
      };
    },
    { access: { openToAll: true } },
  );

  // Read-model query via ctx.queryProjection — auto-tenant-scoped. The
  // helper collapses the zero-argument "return this projection" pattern
  // into a single call; returns { rows } so the response shape stays
  // consistent with other list handlers.
  r.queryHandler(
    defineProjectionQueryHandler("revenue:list", "showcase:projection:customer-revenue", {
      access: { openToAll: true },
    }),
  );

  // Slow synthetic export — demonstrates ctx.signal honouring inside a
  // long-running handler loop. Real-world equivalents: PDF batch export,
  // bulk CSV download, multi-stream audit walk. Mobile clients that
  // navigate away mid-export should NOT keep the server busy producing
  // bytes nobody will read. The handler checks ctx.signal at every
  // iteration; on abort, throws and the dispatcher returns an error to
  // the (already-disconnected) client.
  r.queryHandler(
    "ops:slow-export",
    z.object({ chunks: z.number().int().min(1).max(1000) }),
    async (query, ctx) => {
      const accumulated: number[] = [];
      for (let i = 0; i < query.payload.chunks; i++) {
        ctx.signal?.throwIfAborted();
        // Fake "work per chunk". Realistic handler would assemble a row,
        // hit a remote service, etc.
        await new Promise((resolve) => setTimeout(resolve, 10));
        accumulated.push(i);
      }
      return { processed: accumulated.length };
    },
    { access: { roles: ["Admin"] } },
  );
});
