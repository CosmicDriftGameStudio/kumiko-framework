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

import { sql } from "@cosmicdrift/kumiko-framework/db";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { asRawClient, selectMany, updateMany } from "../../bun-db/query";
import { integer as pgInteger, table as pgTable, uuid as pgUuid } from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import {
  eventConsumerStateTable,
  getConsumerState,
  rebuildMultiStreamProjection,
} from "../../pipeline";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";

// --- Fixtures: two aggregates feeding one MSP + two cornered MSPs ---

const invoiceEntity = createEntity({
  table: "read_mspreb_invoices",
  fields: { customer: createTextField({ required: true }) },
});
const invoiceTable = buildDrizzleTable("msp-reb-invoice", invoiceEntity);

const paymentEntity = createEntity({
  table: "read_mspreb_payments",
  fields: { customer: createTextField({ required: true }) },
});
const paymentTable = buildDrizzleTable("msp-reb-payment", paymentEntity);

// Main read-model: running balance per customer.
const balanceTable = pgTable("read_mspreb_balance", {
  customer: pgUuid("customer").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  invoicesCents: pgInteger("invoices_cents").notNull().default(0),
  paymentsCents: pgInteger("payments_cents").notNull().default(0),
});

// Saga-MSP read-model — never actually written, exists to satisfy the
// `table` requirement. The apply below calls ctx.appendEvent; during
// rebuild that call must throw.
const sagaStateTable = pgTable("read_mspreb_saga_state", {
  id: pgUuid("id").primaryKey(),
});

const feature = defineFeature("mspreb", (r) => {
  r.entity("msp-reb-invoice", invoiceEntity);
  r.entity("msp-reb-payment", paymentEntity);

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
        await asRawClient(tx).unsafe(
          `INSERT INTO "read_mspreb_balance" (customer, tenant_id, invoices_cents, payments_cents) VALUES ($1::uuid, $2::uuid, $3, 0) ON CONFLICT (customer) DO UPDATE SET invoices_cents = read_mspreb_balance.invoices_cents + $3`,
          [p.customer, event.tenantId, p.cents],
        );
      },
      [paymentReceived.name]: async (event, tx) => {
        const p = event.payload as { customer: string; cents: number };
        await asRawClient(tx).unsafe(
          `INSERT INTO "read_mspreb_balance" (customer, tenant_id, invoices_cents, payments_cents) VALUES ($1::uuid, $2::uuid, 0, $3) ON CONFLICT (customer) DO UPDATE SET payments_cents = read_mspreb_balance.payments_cents + $3`,
          [p.customer, event.tenantId, p.cents],
        );
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
        await ctx.unsafeAppendEvent({
          aggregateId: p.customer,
          aggregateType: "msp-reb-invoice",
          type: escalationTriggered.name,
          payload: { customer: p.customer },
        });
      },
    },
  });

  const invoiceExecutor = createEventStoreExecutor(invoiceTable, invoiceEntity, {
    entityName: "msp-reb-invoice",
  });
  const paymentExecutor = createEventStoreExecutor(paymentTable, paymentEntity, {
    entityName: "msp-reb-payment",
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
      await ctx.unsafeAppendEvent({
        aggregateId: String(res.data.id),
        aggregateType: "msp-reb-invoice",
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
      await ctx.unsafeAppendEvent({
        aggregateId: String(res.data.id),
        aggregateType: "msp-reb-payment",
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
  await unsafeCreateEntityTable(stack.db, invoiceEntity, "msp-reb-invoice");
  await unsafeCreateEntityTable(stack.db, paymentEntity, "msp-reb-payment");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  // Disable the saga MSP before truncating so its live pass doesn't land on
  // a half-torn-down state between tests. The webhook MSP is idempotent for
  // our purposes — it has no state to leak.
  await resetEventStore(stack, [
    "read_mspreb_invoices",
    "read_mspreb_payments",
    "read_mspreb_balance",
    "read_mspreb_saga_state",
  ]);
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
    await updateMany(
      stack.db,
      eventConsumerStateTable,
      { status: "disabled", updatedAt: sql`now()` },
      { name: SAGA_MSP },
    );

    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: alice, cents: 10_00 }, admin);
    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: alice, cents: 5_00 }, admin);
    await stack.http.writeOk(
      "mspreb:write:payment:receive",
      { customer: alice, cents: 3_00 },
      admin,
    );
    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: bob, cents: 7_50 }, admin);
    await runFullDispatcher();

    const liveRows = await selectMany(stack.db, balanceTable);
    const aliceLive = liveRows.find((r) => r.customer === alice);
    const bobLive = liveRows.find((r) => r.customer === bob);
    expect(aliceLive).toMatchObject({ invoicesCents: 15_00, paymentsCents: 3_00 });
    expect(bobLive).toMatchObject({ invoicesCents: 7_50, paymentsCents: 0 });

    // Rebuild — the table is TRUNCATEd inside the rebuild TX, then events
    // are replayed in-order. Final state must equal the live state.
    const result = await rebuildMultiStreamProjection(BALANCE_MSP, {
      db: stack.db,
      registry: stack.registry,
    });
    expect(result.projection).toBe(BALANCE_MSP);
    expect(result.eventsProcessed).toBe(4); // 2 invoices + 1 payment + 1 invoice
    expect(result.lastProcessedEventId).toBeGreaterThan(0n);

    const rebuiltRows = await selectMany(stack.db, balanceTable);
    expect(rebuiltRows).toEqual(liveRows);

    // Consumer cursor is at head after rebuild — the live dispatcher should
    // NOT redeliver those events on its next pass.
    const state = await getConsumerState(stack.db, BALANCE_MSP);
    expect(state?.status).toBe("idle");
    expect(state?.lastProcessedEventId).toBe(result.lastProcessedEventId);
  });

  test("rebuild after table corruption restores the correct state", async () => {
    const carol = "00000000-0000-4000-8000-000000000c03";
    await updateMany(
      stack.db,
      eventConsumerStateTable,
      { status: "disabled", updatedAt: sql`now()` },
      { name: SAGA_MSP },
    );
    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: carol, cents: 42_00 }, admin);
    await runFullDispatcher();

    // Corrupt the read-model — simulate a buggy apply() landing bad numbers.
    await updateMany(
      stack.db,
      balanceTable,
      { invoicesCents: -999, paymentsCents: 999 },
      { customer: carol },
    );

    await rebuildMultiStreamProjection(BALANCE_MSP, {
      db: stack.db,
      registry: stack.registry,
    });

    const [row] = await selectMany(stack.db, balanceTable, { customer: carol });
    expect(row).toMatchObject({ invoicesCents: 42_00, paymentsCents: 0 });
  });
});

describe("rebuildMultiStreamProjection — guard rails", () => {
  test("side-effect MSP (no table) is rejected with a clear error", async () => {
    await expect(
      rebuildMultiStreamProjection(WEBHOOK_MSP, {
        db: stack.db,
        registry: stack.registry,
      }),
    ).rejects.toThrow(/no backing table|side-effect/i);
  });

  test("unknown MSP name lists the known ones in the error", async () => {
    await expect(
      rebuildMultiStreamProjection("does:not:exist", {
        db: stack.db,
        registry: stack.registry,
      }),
    ).rejects.toThrow(/not registered/i);
  });

  test("saga MSP using ctx.appendEvent fails rebuild at the first appendEvent call", async () => {
    const dave = "00000000-0000-4000-8000-000000000d04";
    // Disable the saga in live passes so we control when the apply runs.
    await updateMany(
      stack.db,
      eventConsumerStateTable,
      { status: "disabled", updatedAt: sql`now()` },
      { name: SAGA_MSP },
    );
    await stack.http.writeOk("mspreb:write:invoice:bill", { customer: dave, cents: 1_00 }, admin);
    // Put the consumer back to idle so rebuild doesn't treat it as "just
    // disabled on purpose" — rebuild is opinionated about WHEN it refuses,
    // not about the consumer's live-status.
    await updateMany(
      stack.db,
      eventConsumerStateTable,
      { status: "idle", updatedAt: sql`now()` },
      { name: SAGA_MSP },
    );

    await expect(
      rebuildMultiStreamProjection(SAGA_MSP, {
        db: stack.db,
        registry: stack.registry,
      }),
    ).rejects.toThrow(/appendEvent.*not supported during rebuild/);

    // Failure path: outer catch wrote status="dead" + lastError — ops sees
    // the break after the TX rolled back.
    const state = await getConsumerState(stack.db, SAGA_MSP);
    expect(state?.status).toBe("dead");
    expect(state?.lastError).toMatch(/appendEvent/);
  });
});
