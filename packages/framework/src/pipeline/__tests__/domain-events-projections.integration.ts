// Gold-standard (Marten) event sourcing: domain events emitted via
// ctx.appendEvent land on the same aggregate stream as the auto CRUD events,
// and inline projections fire off both. This test pins the end-to-end path:
//
//   HTTP → Dispatcher → writeHandler → CRUD create (auto-event)
//                                    → ctx.appendEvent (domain event)
//                                    → projections for BOTH apply inline
//
// Without all three pieces wired together (registry opens defineEvent names,
// projections-runner fires on appendEvent, dispatcher routes appendEvent to
// the aggregate stream), any of the assertions below go red.

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  integer as pgInteger,
  table as pgTable,
  text as pgText,
  uuid as pgUuid,
} from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { loadAggregate } from "../../event-store";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";

// --- Entity ---

const shipmentEntity = createEntity({
  table: "domain_shipments",
  idType: "uuid",
  fields: {
    cargo: createTextField({ required: true }),
    status: createTextField({ required: true }),
  },
});

const shipmentTable = buildDrizzleTable("domainShipment", shipmentEntity);

// --- Read-model table (fed by the projection below) ---

const billingTable = pgTable("domain_shipment_billing", {
  shipmentId: pgUuid("shipment_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  cargo: pgText("cargo").notNull(),
  totalCost: pgInteger("total_cost").notNull().default(0),
  billedMarker: pgText("billed_marker").notNull().default("pending"),
});

// --- Feature ---

const shippingFeature = defineFeature("shipping", (r) => {
  r.entity("domainShipment", shipmentEntity);

  // Domain event. Qualified name is "shipping:event:billed".
  const shipmentBilled = r.defineEvent("billed", z.object({ cost: z.number() }));

  r.projection({
    name: "shipment-billing",
    source: "domainShipment",
    table: billingTable,
    apply: {
      // Auto CRUD event — fires on shipment create.
      "domainShipment.created": async (event, tx) => {
        const payload = event.payload as { cargo?: string };
        await tx.insert(billingTable).values({
          shipmentId: event.aggregateId,
          tenantId: event.tenantId,
          cargo: payload.cargo ?? "",
          totalCost: 0,
          billedMarker: "pending",
        });
      },
      // Domain event — fires on ctx.appendEvent. Same aggregate stream as
      // the auto-event above, so the UPDATE below targets the row that the
      // create-apply just inserted.
      [shipmentBilled.name]: async (event, tx) => {
        const payload = event.payload as { cost: number };
        await tx
          .update(billingTable)
          .set({ totalCost: payload.cost, billedMarker: "billed" })
          .where(eq(billingTable.shipmentId, event.aggregateId));
      },
    },
  });

  const shipmentExecutor = createEventStoreExecutor(shipmentTable, shipmentEntity, {
    entityName: "domainShipment",
  });

  r.writeHandler(
    "shipment:create",
    z.object({ cargo: z.string(), status: z.string() }),
    async (event, ctx) => shipmentExecutor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "shipment:bill",
    z.object({ id: z.uuid(), cost: z.number() }),
    async (event, ctx) => {
      await ctx.appendEvent({
        aggregateId: event.payload.id,
        aggregateType: "domainShipment",
        type: shipmentBilled.name,
        payload: { cost: event.payload.cost },
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

  // Misuse probes — only exist so the tests below can exercise the rejection
  // paths without spinning up a second feature (that would duplicate the
  // entity and fail at registry build time).
  r.writeHandler(
    "shipment:bill-unregistered",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      await ctx.appendEvent({
        aggregateId: event.payload.id,
        aggregateType: "domainShipment",
        type: "shipping:event:ghost", // never defined via r.defineEvent
        payload: {},
      });
      return { isSuccess: true as const, data: {} };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "shipment:bill-bad-payload",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      await ctx.appendEvent({
        aggregateId: event.payload.id,
        aggregateType: "domainShipment",
        type: shipmentBilled.name,
        // cost must be a number per the defineEvent schema
        payload: { cost: "definitely-not-a-number" } as unknown as { cost: number },
      });
      return { isSuccess: true as const, data: {} };
    },
    { access: { roles: ["Admin"] } },
  );
});

// --- Test stack ---

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [shippingFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, shipmentEntity, "domainShipment");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await stack.db.db.execute(
    sql`TRUNCATE events, domain_shipments, domain_shipment_billing RESTART IDENTITY CASCADE`,
  );
});

// --- Tests ---

describe("Marten gold-standard: domain events → inline projections", () => {
  test("auto CRUD event triggers projection (regression guard)", async () => {
    const data = await stack.http.writeOk<{ id: string }>(
      "shipping:write:shipment:create",
      { cargo: "Container A", status: "loaded" },
      admin,
    );

    const rows = await stack.db.db.select().from(billingTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shipmentId).toBe(data.id);
    expect(rows[0]?.billedMarker).toBe("pending");
    expect(rows[0]?.totalCost).toBe(0);
  });

  test("ctx.appendEvent writes to the aggregate stream and triggers its projection", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "shipping:write:shipment:create",
      { cargo: "Container B", status: "loaded" },
      admin,
    );

    await stack.http.writeOk("shipping:write:shipment:bill", { id: created.id, cost: 1500 }, admin);

    const [row] = await stack.db.db
      .select()
      .from(billingTable)
      .where(eq(billingTable.shipmentId, created.id));
    expect(row).toBeDefined();
    expect(row?.billedMarker).toBe("billed");
    expect(row?.totalCost).toBe(1500);
  });

  test("domain event lives on the same aggregate stream as the auto event", async () => {
    // The critical Marten invariant: every event belongs to one stream.
    // The auto "created" event and the domain "billed" event must share
    // (aggregateId, aggregateType) and be ordered by version.
    const created = await stack.http.writeOk<{ id: string }>(
      "shipping:write:shipment:create",
      { cargo: "Container C", status: "loaded" },
      admin,
    );
    await stack.http.writeOk("shipping:write:shipment:bill", { id: created.id, cost: 999 }, admin);

    const events = await loadAggregate(stack.db.db, created.id, admin.tenantId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(["domainShipment.created", "shipping:event:billed"]);
    expect(events.map((e) => e.version)).toEqual([1, 2]);
    expect(events.every((e) => e.aggregateType === "domainShipment")).toBe(true);
    expect(events.every((e) => e.aggregateId === created.id)).toBe(true);
  });

  test("appendEvent with an unregistered type is rejected at the emit site", async () => {
    // No r.defineEvent for "shipping:event:ghost" — the dispatcher must
    // reject before the event reaches the events-table. Otherwise malformed
    // events would only surface at consumer-time, durably persisted.
    const created = await stack.http.writeOk<{ id: string }>(
      "shipping:write:shipment:create",
      { cargo: "Container D", status: "loaded" },
      admin,
    );

    const res = await stack.http.write(
      "shipping:write:shipment:bill-unregistered",
      { id: created.id },
      admin,
    );
    // Unknown event → InternalError → HTTP 500.
    expect(res.status).toBe(500);

    // Nothing for the ghost type is on disk.
    const events = await loadAggregate(stack.db.db, created.id, admin.tenantId);
    expect(events.some((e) => e.type === "shipping:event:ghost")).toBe(false);
  });

  test("payload validation runs before the event hits the events-table", async () => {
    // defineEvent says cost is a number. Sending a string must abort the
    // append (via Zod) — no malformed domain event ends up durable.
    const created = await stack.http.writeOk<{ id: string }>(
      "shipping:write:shipment:create",
      { cargo: "Container E", status: "loaded" },
      admin,
    );

    const res = await stack.http.write(
      "shipping:write:shipment:bill-bad-payload",
      { id: created.id },
      admin,
    );
    expect([400, 422, 500]).toContain(res.status);

    const events = await loadAggregate(stack.db.db, created.id, admin.tenantId);
    expect(events.some((e) => e.type === "shipping:event:billed")).toBe(false);
  });
});
