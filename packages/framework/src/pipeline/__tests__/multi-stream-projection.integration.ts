// C3 — r.multiStreamProjection (Marten-aligned, async-only).
//
// The cross-aggregate read model. A single MSP reacts to events from many
// streams, groups by an identity the apply handler extracts from the
// payload, and materializes into one projection table. Runs async via the
// event-dispatcher — at-least-once delivery, strictly ordered by events.id
// per MSP consumer, dead-letters on repeated handler failures.

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { integer as pgInteger, table as pgTable, uuid as pgUuid } from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";

// --- Two aggregate types that feed one MSP ---

const shipmentEntity = createEntity({
  table: "msp_shipments",
  idType: "uuid",
  fields: { customer: createTextField({ required: true }) },
});
const shipmentTable = buildDrizzleTable("mspShipment", shipmentEntity);

const refundEntity = createEntity({
  table: "msp_refunds",
  idType: "uuid",
  fields: { customer: createTextField({ required: true }) },
});
const refundTable = buildDrizzleTable("mspRefund", refundEntity);

// Cross-cutting MSP: one row per customer, sums shipments − refunds. Key
// differences from a single-stream projection:
//   - feeds off TWO aggregate types (shipment + refund), no shared entity
//   - identity key (customer UUID) lives in the event payload, not
//     aggregate_id — extracted inside the apply handler
const customerBalanceTable = pgTable("msp_customer_balance", {
  customer: pgUuid("customer").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  shipments: pgInteger("shipments").notNull().default(0),
  refunds: pgInteger("refunds").notNull().default(0),
  netCents: pgInteger("net_cents").notNull().default(0),
});

const mspFeature = defineFeature("msptest", (r) => {
  r.entity("mspShipment", shipmentEntity);
  r.entity("mspRefund", refundEntity);

  const shipmentBilled = r.defineEvent(
    "shipment-billed",
    z.object({ customer: z.uuid(), cents: z.number().int() }),
  );
  const refundIssued = r.defineEvent(
    "refund-issued",
    z.object({ customer: z.uuid(), cents: z.number().int() }),
  );

  r.multiStreamProjection({
    name: "customer-balance",
    table: customerBalanceTable,
    apply: {
      [shipmentBilled.name]: async (event, tx) => {
        const p = event.payload as { customer: string; cents: number };
        await tx
          .insert(customerBalanceTable)
          .values({
            customer: p.customer,
            tenantId: event.tenantId,
            shipments: 1,
            refunds: 0,
            netCents: p.cents,
          })
          .onConflictDoUpdate({
            target: customerBalanceTable.customer,
            set: {
              shipments: sql`${customerBalanceTable.shipments} + 1`,
              netCents: sql`${customerBalanceTable.netCents} + ${p.cents}`,
            },
          });
      },
      [refundIssued.name]: async (event, tx) => {
        const p = event.payload as { customer: string; cents: number };
        await tx
          .insert(customerBalanceTable)
          .values({
            customer: p.customer,
            tenantId: event.tenantId,
            shipments: 0,
            refunds: 1,
            netCents: -p.cents,
          })
          .onConflictDoUpdate({
            target: customerBalanceTable.customer,
            set: {
              refunds: sql`${customerBalanceTable.refunds} + 1`,
              netCents: sql`${customerBalanceTable.netCents} - ${p.cents}`,
            },
          });
      },
    },
  });

  const shipmentExecutor = createEventStoreExecutor(shipmentTable, shipmentEntity, {
    entityName: "mspShipment",
  });
  const refundExecutor = createEventStoreExecutor(refundTable, refundEntity, {
    entityName: "mspRefund",
  });

  r.writeHandler(
    "shipment:bill",
    z.object({ customer: z.uuid(), cents: z.number().int() }),
    async (event, ctx) => {
      const res = await shipmentExecutor.create(
        { customer: event.payload.customer },
        event.user,
        ctx.db,
      );
      if (!res.isSuccess) return res;
      await ctx.appendEvent({
        aggregateId: String(res.data.id),
        aggregateType: "mspShipment",
        type: shipmentBilled.name,
        payload: { customer: event.payload.customer, cents: event.payload.cents },
      });
      return res;
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "refund:issue",
    z.object({ customer: z.uuid(), cents: z.number().int() }),
    async (event, ctx) => {
      const res = await refundExecutor.create(
        { customer: event.payload.customer },
        event.user,
        ctx.db,
      );
      if (!res.isSuccess) return res;
      await ctx.appendEvent({
        aggregateId: String(res.data.id),
        aggregateType: "mspRefund",
        type: refundIssued.name,
        payload: { customer: event.payload.customer, cents: event.payload.cents },
      });
      return res;
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [mspFeature], systemHooks: [] });
  await createEntityTable(stack.db.db, shipmentEntity, "mspShipment");
  await createEntityTable(stack.db.db, refundEntity, "mspRefund");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await stack.db.db.execute(
    sql`TRUNCATE events, msp_shipments, msp_refunds, msp_customer_balance, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
});

describe("r.multiStreamProjection — Marten MultiStreamProjection equivalent", () => {
  test("events from two aggregate types roll up into one customer row", async () => {
    const customerA = "00000000-0000-4000-8000-000000000a11";
    const customerB = "00000000-0000-4000-8000-000000000b22";

    await stack.http.writeOk(
      "msptest:write:shipment:bill",
      { customer: customerA, cents: 1000 },
      admin,
    );
    await stack.http.writeOk(
      "msptest:write:shipment:bill",
      { customer: customerA, cents: 500 },
      admin,
    );
    await stack.http.writeOk(
      "msptest:write:refund:issue",
      { customer: customerA, cents: 200 },
      admin,
    );
    await stack.http.writeOk(
      "msptest:write:shipment:bill",
      { customer: customerB, cents: 300 },
      admin,
    );

    // Drain the dispatcher — MSPs run async.
    await stack.eventDispatcher?.runOnce();

    const rows = await stack.db.db
      .select()
      .from(customerBalanceTable)
      .orderBy(customerBalanceTable.customer);
    const byCustomer = new Map(rows.map((r) => [r.customer, r]));

    expect(byCustomer.get(customerA)).toMatchObject({
      shipments: 2,
      refunds: 1,
      netCents: 1300, // 1000 + 500 - 200
    });
    expect(byCustomer.get(customerB)).toMatchObject({
      shipments: 1,
      refunds: 0,
      netCents: 300,
    });
  });

  test("MSP consumer owns a cursor — second runOnce is a no-op when caught up", async () => {
    const cust = "00000000-0000-4000-8000-000000000c33";
    await stack.http.writeOk("msptest:write:shipment:bill", { customer: cust, cents: 42 }, admin);

    const pass1 = await stack.eventDispatcher?.runOnce();
    const pass2 = await stack.eventDispatcher?.runOnce();

    // The MSP consumer processed the single event once; the cursor then
    // holds it, so pass2 sees zero events for that consumer.
    const mspName = "msptest:projection:customer-balance";
    expect(pass1?.byConsumer[mspName]?.processed).toBeGreaterThanOrEqual(1);
    expect(pass2?.byConsumer[mspName]?.processed ?? 0).toBe(0);

    // Row state is stable across the no-op pass.
    const [row] = await stack.db.db
      .select()
      .from(customerBalanceTable)
      .where(eq(customerBalanceTable.customer, cust));
    expect(row?.shipments).toBe(1);
    expect(row?.netCents).toBe(42);
  });

  test("events the MSP does not subscribe to pass through untouched", async () => {
    // A pure CRUD create (mspShipment.created) is not in the MSP's apply
    // map — the handler should ignore it without throwing, even though the
    // dispatcher still routes it past the consumer.
    const cust = "00000000-0000-4000-8000-000000000d44";
    await stack.http.writeOk("msptest:write:shipment:bill", { customer: cust, cents: 77 }, admin);
    await stack.eventDispatcher?.runOnce();

    // Only the shipment-billed event was folded in; the auto "created"
    // event was silently skipped.
    const [row] = await stack.db.db
      .select()
      .from(customerBalanceTable)
      .where(eq(customerBalanceTable.customer, cust));
    expect(row?.shipments).toBe(1);
  });
});

describe("r.multiStreamProjection — registrar validation", () => {
  test("empty apply map is rejected", () => {
    expect(() =>
      defineFeature("mspbad", (r) => {
        r.entity("mspShipment", shipmentEntity);
        r.multiStreamProjection({
          name: "empty",
          table: customerBalanceTable,
          apply: {},
        });
      }),
    ).toThrow(/no apply handlers/);
  });

  test("name collision with single-stream projection is rejected", () => {
    expect(() =>
      defineFeature("mspcollision", (r) => {
        r.entity("mspShipment", shipmentEntity);
        r.projection({
          name: "shared",
          source: "mspShipment",
          table: customerBalanceTable,
          apply: { "mspShipment.created": async () => {} },
        });
        r.multiStreamProjection({
          name: "shared",
          table: customerBalanceTable,
          apply: { "msptest:event:shipment-billed": async () => {} },
        });
      }),
    ).toThrow(/already registered/);
  });
});
