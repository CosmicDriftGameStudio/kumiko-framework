// C3 — r.multiStreamProjection (Marten-aligned, async-only).
//
// The cross-aggregate read model. A single MSP reacts to events from many
// streams, groups by an identity the apply handler extracts from the
// payload, and materializes into one projection table. Runs async via the
// event-dispatcher — at-least-once delivery, strictly ordered by events.id
// per MSP consumer, dead-letters on repeated handler failures.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { asRawClient, selectMany } from "../../bun-db/query";
import { integer as pgInteger, table as pgTable, uuid as pgUuid } from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";

// --- Two aggregate types that feed one MSP ---

const shipmentEntity = createEntity({
  table: "read_msp_shipments",
  fields: { customer: createTextField({ required: true }) },
});
const shipmentTable = buildDrizzleTable("msp-shipment", shipmentEntity);

const refundEntity = createEntity({
  table: "read_msp_refunds",
  fields: { customer: createTextField({ required: true }) },
});
const refundTable = buildDrizzleTable("msp-refund", refundEntity);

// Cross-cutting MSP: one row per customer, sums shipments − refunds. Key
// differences from a single-stream projection:
//   - feeds off TWO aggregate types (shipment + refund), no shared entity
//   - identity key (customer UUID) lives in the event payload, not
//     aggregate_id — extracted inside the apply handler
const customerBalanceTable = pgTable("read_msp_customer_balance", {
  customer: pgUuid("customer").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  shipments: pgInteger("shipments").notNull().default(0),
  refunds: pgInteger("refunds").notNull().default(0),
  netCents: pgInteger("net_cents").notNull().default(0),
});

const mspFeature = defineFeature("msptest", (r) => {
  r.entity("msp-shipment", shipmentEntity);
  r.entity("msp-refund", refundEntity);

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
        await asRawClient(tx).unsafe(
          `INSERT INTO "read_msp_customer_balance" (customer, tenant_id, shipments, refunds, net_cents) VALUES ($1::uuid, $2::uuid, 1, 0, $3) ON CONFLICT (customer) DO UPDATE SET shipments = read_msp_customer_balance.shipments + 1, net_cents = read_msp_customer_balance.net_cents + $3`,
          [p.customer, event.tenantId, p.cents],
        );
      },
      [refundIssued.name]: async (event, tx) => {
        const p = event.payload as { customer: string; cents: number };
        await asRawClient(tx).unsafe(
          `INSERT INTO "read_msp_customer_balance" (customer, tenant_id, shipments, refunds, net_cents) VALUES ($1::uuid, $2::uuid, 0, 1, -$3) ON CONFLICT (customer) DO UPDATE SET refunds = read_msp_customer_balance.refunds + 1, net_cents = read_msp_customer_balance.net_cents - $3`,
          [p.customer, event.tenantId, p.cents],
        );
      },
    },
  });

  const shipmentExecutor = createEventStoreExecutor(shipmentTable, shipmentEntity, {
    entityName: "msp-shipment",
  });
  const refundExecutor = createEventStoreExecutor(refundTable, refundEntity, {
    entityName: "msp-refund",
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
      await ctx.unsafeAppendEvent({
        aggregateId: String(res.data.id),
        aggregateType: "msp-shipment",
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
      await ctx.unsafeAppendEvent({
        aggregateId: String(res.data.id),
        aggregateType: "msp-refund",
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
  await unsafeCreateEntityTable(stack.db, shipmentEntity, "msp-shipment");
  await unsafeCreateEntityTable(stack.db, refundEntity, "msp-refund");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, [
    "read_msp_shipments",
    "read_msp_refunds",
    "read_msp_customer_balance",
  ]);
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

    const rows = await selectMany(stack.db, customerBalanceTable);
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
    const [row] = await selectMany(stack.db, customerBalanceTable, { customer: cust });
    expect(row?.shipments).toBe(1);
    expect(row?.netCents).toBe(42);
  });

  test("MSP apply receives event.tenantId correctly across tenants (isolation pin)", async () => {
    // Regression pin: MSP apply does NOT get a tenant-scoped TenantDb (the
    // old r.postEvent wrap). Instead the apply handler reads event.tenantId
    // and writes it into the projection row. Verify that two tenants feeding
    // the same MSP land in distinct rows carrying their own tenantId — not
    // cross-tenant leaks, not hardcoded wrong tenant.
    const otherAdmin = createTestUser({
      id: 77,
      roles: ["Admin"],
      tenantId: "00000000-0000-4000-8000-000000000099",
    });
    const customerAlpha = "00000000-0000-4000-8000-000000000aa1";
    const customerBeta = "00000000-0000-4000-8000-000000000bb2";

    await stack.http.writeOk(
      "msptest:write:shipment:bill",
      { customer: customerAlpha, cents: 1000 },
      admin,
    );
    await stack.http.writeOk(
      "msptest:write:shipment:bill",
      { customer: customerBeta, cents: 2000 },
      otherAdmin,
    );
    await stack.eventDispatcher?.runOnce();

    const rows = await selectMany(stack.db, customerBalanceTable);
    const alpha = rows.find((r) => r.customer === customerAlpha);
    const beta = rows.find((r) => r.customer === customerBeta);

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect(alpha?.tenantId).toBe(admin.tenantId);
    expect(beta?.tenantId).toBe(otherAdmin.tenantId);
    expect(alpha?.netCents).toBe(1000);
    expect(beta?.netCents).toBe(2000);
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
    const [row] = await selectMany(stack.db, customerBalanceTable, { customer: cust });
    expect(row?.shipments).toBe(1);
  });
});

describe("r.multiStreamProjection — registrar validation", () => {
  test("empty apply map is rejected", () => {
    expect(() =>
      defineFeature("mspbad", (r) => {
        r.entity("msp-shipment", shipmentEntity);
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
        r.entity("msp-shipment", shipmentEntity);
        r.projection({
          name: "shared",
          source: "msp-shipment",
          table: customerBalanceTable,
          apply: { "msp-shipment.created": async () => {} },
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
