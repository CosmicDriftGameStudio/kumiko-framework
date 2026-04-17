// MSP-Rebuild — symmetric to projection-rebuild.integration.ts, exercises
// the MultiStreamProjection rebuild path:
//
//   1. Live → drain → read-model X; rebuild → read-model X (idempotent).
//   2. Corrupt read-model after live drain → rebuild restores the correct
//      state (load-bearing "read-models are rebuildable" claim).
//   3. Side-effect MSP (no table) → rebuild rejects with a clear error.
//   4. Saga-style MSP emitting ctx.appendEvent → rebuild rejects when the
//      apply reaches appendEvent (replaying events that already live in
//      the log would be a double-write).
//   5. cursor is advanced to the last processed event after rebuild so
//      live dispatcher passes don't redeliver what rebuild consumed.
//
// Deliberately separate from projection-rebuild.integration.ts because MSPs
// carry a different state row (kumiko_event_consumers, not kumiko_projections)
// and a different apply signature (3rd ctx arg).

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { integer as pgInteger, table as pgTable, uuid as pgUuid } from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import {
  eventConsumerStateTable,
  getConsumerState,
  rebuildMultiStreamProjection,
} from "../../pipeline";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";

// --- Fixtures: two aggregates feeding one MSP + two cornered MSPs ---

const invoiceEntity = createEntity({
  table: "mspreb_invoices",
  idType: "uuid",
  fields: { customer: createTextField({ required: true }) },
});
const invoiceTable = buildDrizzleTable("mspRebInvoice", invoiceEntity);

const paymentEntity = createEntity({
  table: "mspreb_payments",
  idType: "uuid",
  fields: { customer: createTextField({ required: true }) },
});
const paymentTable = buildDrizzleTable("mspRebPayment", paymentEntity);

// Main read-model: running balance per customer.
const balanceTable = pgTable("mspreb_balance", {
  customer: pgUuid("customer").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  invoicesCents: pgInteger("invoices_cents").notNull().default(0),
  paymentsCents: pgInteger("payments_cents").notNull().default(0),
});

// Saga-MSP read-model — never actually written, exists to satisfy the
// `table` requirement. The apply below calls ctx.appendEvent; during
// rebuild that call must throw.
const sagaStateTable = pgTable("mspreb_saga_state", {
  id: pgUuid("id").primaryKey(),
});

const feature = defineFeature("mspreb", (r) => {
  r.entity("mspRebInvoice", invoiceEntity);
  r.entity("mspRebPayment", paymentEntity);

  const invoiceBilled = r.defineEvent(
    "invoice-billed",
    z.object({ customer: z.uuid(), cents: z.number().int() }),
  );
  const paymentReceived = r.defineEvent(
    "payment-received",
    z.object({ customer: z.uuid(), cents: z.number().int() }),
  );
  const escalationTriggered = r.defineEvent(
    "escalation-triggered",
    z.object({ customer: z.uuid() }),
  );

  // 1) Main rebuildable MSP — table materialized from two event types.
  r.multiStreamProjection({
    name: "customer-balance",
    table: balanceTable,
    apply: {
      [invoiceBilled.name]: async (event, tx) => {
        const p = event.payload as { customer: string; cents: number };
        await tx
          .insert(balanceTable)
          .values({
            customer: p.customer,
            tenantId: event.tenantId,
            invoicesCents: p.cents,
            paymentsCents: 0,
          })
          .onConflictDoUpdate({
            target: balanceTable.customer,
            set: { invoicesCents: sql`${balanceTable.invoicesCents} + ${p.cents}` },
          });
      },
      [paymentReceived.name]: async (event, tx) => {
        const p = event.payload as { customer: string; cents: number };
        await tx
          .insert(balanceTable)
          .values({
            customer: p.customer,
            tenantId: event.tenantId,
            invoicesCents: 0,
            paymentsCents: p.cents,
          })
          .onConflictDoUpdate({
            target: balanceTable.customer,
            set: { paymentsCents: sql`${balanceTable.paymentsCents} + ${p.cents}` },
          });
      },
    },
  });

  // 2) Side-effect-only MSP: no table. rebuild must reject.
  r.multiStreamProjection({
    name: "webhook-sink",
    apply: {
      [invoiceBilled.name]: async () => {
        // would post to an external webhook; the test never exercises live
        // delivery of this one — only the rebuild rejection path.
      },
    },
  });

  // 3) Saga-style MSP: has a table (so rebuild is allowed to start) but
  // the apply calls ctx.appendEvent. Rebuild must throw when it reaches
  // that call.
  r.multiStreamProjection({
    name: "saga-emitter",
    table: sagaStateTable,
    apply: {
      [invoiceBilled.name]: async (event, _tx, ctx) => {
        const p = event.payload as { customer: string };
        await ctx.appendEvent({
          aggregateId: p.customer,
          aggregateType: "mspRebInvoice",
          type: escalationTriggered.name,
          payload: { customer: p.customer },
        });
      },
    },
  });

  const invoiceExecutor = createEventStoreExecutor(invoiceTable, invoiceEntity, {
    entityName: "mspRebInvoice",
  });
  const paymentExecutor = createEventStoreExecutor(paymentTable, paymentEntity, {
    entityName: "mspRebPayment",
  });

  r.writeHandler(
    "invoice:bill",
    z.object({ customer: z.uuid(), cents: z.number().int() }),
    async (event, ctx) => {
      const res = await invoiceExecutor.create(
        { customer: event.payload.customer },
        event.user,
        ctx.db,
      );
      if (!res.isSuccess) return res;
      await ctx.appendEvent({
        aggregateId: String(res.data.id),
        aggregateType: "mspRebInvoice",
        type: invoiceBilled.name,
        payload: event.payload,
      });
      return res;
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "payment:receive",
    z.object({ customer: z.uuid(), cents: z.number().int() }),
    async (event, ctx) => {
      const res = await paymentExecutor.create(
        { customer: event.payload.customer },
        event.user,
        ctx.db,
      );
      if (!res.isSuccess) return res;
      await ctx.appendEvent({
        aggregateId: String(res.data.id),
        aggregateType: "mspRebPayment",
        type: paymentReceived.name,
        payload: event.payload,
      });
      return res;
    },
    { access: { roles: ["Admin"] } },
  );
});

const BALANCE_MSP = "mspreb:projection:customer-balance";
const WEBHOOK_MSP = "mspreb:projection:webhook-sink";
const SAGA_MSP = "mspreb:projection:saga-emitter";

const admin = TestUsers.admin;
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [feature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, invoiceEntity, "mspRebInvoice");
  await createEntityTable(stack.db.db, paymentEntity, "mspRebPayment");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  // Disable the saga MSP before truncating so its live pass doesn't land on
  // a half-torn-down state between tests. The webhook MSP is idempotent for
  // our purposes — it has no state to leak.
  await stack.db.db.execute(
    sql`TRUNCATE events, mspreb_invoices, mspreb_payments, mspreb_balance, mspreb_saga_state, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

// --- Helpers ---

async function runFullDispatcher(): Promise<void> {
  // Drain the dispatcher twice — first pass delivers new events, second pass
  // confirms cursor was saved (no redelivery).
  await stack.eventDispatcher?.runOnce();
}

// --- Tests ---

describe("rebuildMultiStreamProjection — rebuildable read-model", () => {
  test("rebuild from live-produced log re-materializes the exact same state", async () => {
    const alice = "00000000-0000-4000-8000-000000000a01";
    const bob = "00000000-0000-4000-8000-000000000b02";
    // Disable the saga MSP for this test — it runs on the same event types
    // and would trip its own ctx.appendEvent path during live delivery
    // (which is fine in production, but noise here).
    await stack.db.db
      .update(eventConsumerStateTable)
      .set({ status: "disabled", updatedAt: sql`now()` })
      .where(eq(eventConsumerStateTable.name, SAGA_MSP));

    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: alice, cents: 10_00 }, admin);
    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: alice, cents: 5_00 }, admin);
    await stack.http.writeOk(
      "mspreb:write:payment:receive",
      { customer: alice, cents: 3_00 },
      admin,
    );
    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: bob, cents: 7_50 }, admin);
    await runFullDispatcher();

    const liveRows = await stack.db.db.select().from(balanceTable).orderBy(balanceTable.customer);
    const aliceLive = liveRows.find((r) => r.customer === alice);
    const bobLive = liveRows.find((r) => r.customer === bob);
    expect(aliceLive).toMatchObject({ invoicesCents: 15_00, paymentsCents: 3_00 });
    expect(bobLive).toMatchObject({ invoicesCents: 7_50, paymentsCents: 0 });

    // Rebuild — the table is TRUNCATEd inside the rebuild TX, then events
    // are replayed in-order. Final state must equal the live state.
    const result = await rebuildMultiStreamProjection(BALANCE_MSP, {
      db: stack.db.db,
      registry: stack.registry,
    });
    expect(result.projection).toBe(BALANCE_MSP);
    expect(result.eventsProcessed).toBe(4); // 2 invoices + 1 payment + 1 invoice
    expect(result.lastProcessedEventId).toBeGreaterThan(0n);

    const rebuiltRows = await stack.db.db
      .select()
      .from(balanceTable)
      .orderBy(balanceTable.customer);
    expect(rebuiltRows).toEqual(liveRows);

    // Consumer cursor is at head after rebuild — the live dispatcher should
    // NOT redeliver those events on its next pass.
    const state = await getConsumerState(stack.db.db, BALANCE_MSP);
    expect(state?.status).toBe("idle");
    expect(state?.lastProcessedEventId).toBe(result.lastProcessedEventId);
  });

  test("rebuild after table corruption restores the correct state", async () => {
    const carol = "00000000-0000-4000-8000-000000000c03";
    await stack.db.db
      .update(eventConsumerStateTable)
      .set({ status: "disabled", updatedAt: sql`now()` })
      .where(eq(eventConsumerStateTable.name, SAGA_MSP));
    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: carol, cents: 42_00 }, admin);
    await runFullDispatcher();

    // Corrupt the read-model — simulate a buggy apply() landing bad numbers.
    await stack.db.db
      .update(balanceTable)
      .set({ invoicesCents: -999, paymentsCents: 999 })
      .where(eq(balanceTable.customer, carol));

    await rebuildMultiStreamProjection(BALANCE_MSP, {
      db: stack.db.db,
      registry: stack.registry,
    });

    const [row] = await stack.db.db
      .select()
      .from(balanceTable)
      .where(eq(balanceTable.customer, carol));
    expect(row).toMatchObject({ invoicesCents: 42_00, paymentsCents: 0 });
  });
});

describe("rebuildMultiStreamProjection — guard rails", () => {
  test("side-effect MSP (no table) is rejected with a clear error", async () => {
    await expect(
      rebuildMultiStreamProjection(WEBHOOK_MSP, {
        db: stack.db.db,
        registry: stack.registry,
      }),
    ).rejects.toThrow(/no backing table|side-effect/i);
  });

  test("unknown MSP name lists the known ones in the error", async () => {
    await expect(
      rebuildMultiStreamProjection("does:not:exist", {
        db: stack.db.db,
        registry: stack.registry,
      }),
    ).rejects.toThrow(/not registered/i);
  });

  test("saga MSP using ctx.appendEvent fails rebuild at the first appendEvent call", async () => {
    const dave = "00000000-0000-4000-8000-000000000d04";
    // Disable the saga in live passes so we control when the apply runs.
    await stack.db.db
      .update(eventConsumerStateTable)
      .set({ status: "disabled", updatedAt: sql`now()` })
      .where(eq(eventConsumerStateTable.name, SAGA_MSP));
    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: dave, cents: 1_00 }, admin);
    // Put the consumer back to idle so rebuild doesn't treat it as "just
    // disabled on purpose" — rebuild is opinionated about WHEN it refuses,
    // not about the consumer's live-status.
    await stack.db.db
      .update(eventConsumerStateTable)
      .set({ status: "idle", updatedAt: sql`now()` })
      .where(eq(eventConsumerStateTable.name, SAGA_MSP));

    await expect(
      rebuildMultiStreamProjection(SAGA_MSP, {
        db: stack.db.db,
        registry: stack.registry,
      }),
    ).rejects.toThrow(/appendEvent.*not supported during rebuild/);

    // Failure path: outer catch wrote status="dead" + lastError — ops sees
    // the break after the TX rolled back.
    const state = await getConsumerState(stack.db.db, SAGA_MSP);
    expect(state?.status).toBe("dead");
    expect(state?.lastError).toMatch(/appendEvent/);
  });
});
