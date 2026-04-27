// B2 — ctx.loadAggregate HTTP-surface for live aggregation + asOf.
//
// Marten's AggregateStreamAsync<T>(id[, version|timestamp]) in TypeScript
// shape: ctx.loadAggregate(id[, { asOf }]). A queryHandler reduces the
// returned events into whatever domain-state shape the feature wants.
// Events are upcasted by the dispatcher, so the reducer sees the current
// payload shape even for old v1 events.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { append, loadAggregate as loadAggregateRaw } from "../../event-store";
import {
  createEntityTable,
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "../../stack";

// --- Fixture entity ---

const invoiceEntity = createEntity({
  table: "read_asof_invoices",
  fields: {
    customer: createTextField({ required: true }),
    status: createTextField({ required: true }),
  },
});
const invoiceTable = buildDrizzleTable("asof-invoice", invoiceEntity);

// --- Feature ---

const asOfFeature = defineFeature("asoftest", (r) => {
  r.entity("asof-invoice", invoiceEntity);

  // Two domain events at different versions. v1→v2 migration bumps the
  // "amount" field from string to integer cents, same pattern as B1.
  const approved = r.defineEvent(
    "approved",
    z.object({ amount: z.number().int(), approvedBy: z.string() }),
    { version: 2 },
  );
  r.eventMigration("approved", 1, 2, (payload) => {
    const p = payload as { amount: string; approvedBy: string };
    return {
      amount: Math.round(Number.parseFloat(p.amount) * 100),
      approvedBy: p.approvedBy,
    };
  });

  const executor = createEventStoreExecutor(invoiceTable, invoiceEntity, {
    entityName: "asof-invoice",
  });

  r.writeHandler(
    "invoice:create",
    z.object({ customer: z.string(), status: z.string() }),
    async (event, ctx) => executor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "invoice:approve",
    z.object({ id: z.uuid(), amount: z.number().int(), approvedBy: z.string() }),
    async (event, ctx) => {
      await ctx.appendEvent({
        aggregateId: event.payload.id,
        aggregateType: "asof-invoice",
        type: approved.name,
        payload: { amount: event.payload.amount, approvedBy: event.payload.approvedBy },
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

  // Query handler — reduces raw events into a derived shape via
  // ctx.loadAggregate. Exposes live aggregation over HTTP.
  r.queryHandler(
    "invoice:state",
    z.object({
      id: z.uuid(),
      asOf: z.iso.datetime().optional(),
    }),
    async (query, ctx) => {
      const events = await ctx.loadAggregate(query.payload.id, {
        ...(query.payload.asOf ? { asOf: Temporal.Instant.from(query.payload.asOf) } : {}),
      });
      // Simple reducer: collect created + approved facts, ignore the rest.
      const state: {
        id: string | null;
        customer: string | null;
        status: string;
        approved: boolean;
        approvedAmountCents: number | null;
        approvedBy: string | null;
      } = {
        id: null,
        customer: null,
        status: "unknown",
        approved: false,
        approvedAmountCents: null,
        approvedBy: null,
      };
      for (const evt of events) {
        if (evt.type === "asof-invoice.created") {
          const p = evt.payload as { id: string; customer: string; status: string };
          state.id = p.id;
          state.customer = p.customer;
          state.status = p.status;
        } else if (evt.type === approved.name) {
          const p = evt.payload as { amount: number; approvedBy: string };
          state.approved = true;
          state.approvedAmountCents = p.amount;
          state.approvedBy = p.approvedBy;
        }
      }
      return state;
    },
    { access: { openToAll: true } },
  );
});

// --- Test stack ---

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [asOfFeature], systemHooks: [] });
  await createEntityTable(stack.db, invoiceEntity, "asof-invoice");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_asof_invoices"]);
});

// --- Tests ---

describe("ctx.loadAggregate via queryHandler — Marten AggregateStreamAsync equivalent", () => {
  test("reduces created + approved events into current state", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "asoftest:write:invoice:create",
      { customer: "Acme", status: "draft" },
      admin,
    );
    await stack.http.writeOk(
      "asoftest:write:invoice:approve",
      { id: created.id, amount: 1500, approvedBy: "boss" },
      admin,
    );

    const state = await stack.http.queryOk<{
      id: string;
      customer: string;
      status: string;
      approved: boolean;
      approvedAmountCents: number | null;
      approvedBy: string | null;
    }>("asoftest:query:invoice:state", { id: created.id }, admin);

    expect(state.customer).toBe("Acme");
    expect(state.approved).toBe(true);
    expect(state.approvedAmountCents).toBe(1500);
    expect(state.approvedBy).toBe("boss");
  });

  test("asOf excludes events after the given timestamp — Marten point-in-time read", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "asoftest:write:invoice:create",
      { customer: "TimeTraveler", status: "draft" },
      admin,
    );
    // Capture the event timestamp from the events-table for a precise cutoff.
    // A too-small offset risks clock granularity flakes — we rely on the
    // millisecond-precision timestamp column.
    const preApprove = new Date();
    // Make sure the next event's createdAt is strictly after the cutoff.
    await new Promise((r) => setTimeout(r, 10));
    await stack.http.writeOk(
      "asoftest:write:invoice:approve",
      { id: created.id, amount: 9999, approvedBy: "late" },
      admin,
    );

    // "Current" state sees the approval.
    const now = await stack.http.queryOk<{ approved: boolean }>(
      "asoftest:query:invoice:state",
      { id: created.id },
      admin,
    );
    expect(now.approved).toBe(true);

    // asOf preApprove: the approval is in the future, not yet visible.
    const past = await stack.http.queryOk<{ approved: boolean; status: string }>(
      "asoftest:query:invoice:state",
      { id: created.id, asOf: preApprove.toISOString() },
      admin,
    );
    expect(past.approved).toBe(false);
    expect(past.status).toBe("draft");
  });

  test("payloads are upcasted — v1-on-disk events reach the reducer as v2", async () => {
    // Appending directly at eventVersion=1 (older shape) simulates data
    // that predates the current event version. The reducer is written
    // against v2 (integer cents) — without upcasting it would blow up or
    // produce garbage.
    const invoiceId = "00000000-0000-4000-8000-000000000042";
    await stack.db.transaction(async (tx) => {
      await tx.insert(invoiceTable).values({
        id: invoiceId,
        tenantId: admin.tenantId,
        customer: "LegacyCo",
        status: "imported",
      });

      // Initial "created" event at v1 of that too — but asofInvoice.created
      // has no migration, its eventVersion is irrelevant here.
      await append(tx, {
        aggregateId: invoiceId,
        aggregateType: "asof-invoice",
        tenantId: admin.tenantId,
        expectedVersion: 0,
        type: "asof-invoice.created",
        payload: { id: invoiceId, customer: "LegacyCo", status: "imported" },
        metadata: { userId: admin.id },
      });
      await append(tx, {
        aggregateId: invoiceId,
        aggregateType: "asof-invoice",
        tenantId: admin.tenantId,
        expectedVersion: 1,
        type: "asoftest:event:approved",
        eventVersion: 1,
        payload: { amount: "42.50", approvedBy: "legacy" },
        metadata: { userId: admin.id },
      });
    });

    const state = await stack.http.queryOk<{
      approved: boolean;
      approvedAmountCents: number | null;
      approvedBy: string | null;
    }>("asoftest:query:invoice:state", { id: invoiceId }, admin);

    // "42.50" EUR → 4250 cents after the v1→v2 upcaster runs on read.
    expect(state.approved).toBe(true);
    expect(state.approvedAmountCents).toBe(4250);
    expect(state.approvedBy).toBe("legacy");

    // Raw reader (no upcasting) still sees the original shape on disk —
    // upcasting is a read-time transform, writes stay immutable.
    const raw = await loadAggregateRaw(stack.db, invoiceId, admin.tenantId);
    const rawApproved = raw.find((e) => e.type === "asoftest:event:approved");
    expect(rawApproved?.eventVersion).toBe(1);
    expect(rawApproved?.payload).toEqual({ amount: "42.50", approvedBy: "legacy" });
  });
});
