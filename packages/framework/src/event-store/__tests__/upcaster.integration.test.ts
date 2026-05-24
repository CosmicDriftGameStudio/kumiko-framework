// B1 — r.eventMigration + event_version routing (Marten upcaster).
//
// Covers the two load-bearing claims:
//   1. Stored v(N) payloads are transparently upgraded to v(current) when
//      read through the upcaster. Projections and any future aggregate
//      loader see the current shape regardless of how old the event is.
//   2. Boot-time validation refuses incomplete chains. Declaring version=3
//      with only a 1→2 migration fails immediately, so a missing upcaster
//      can never silently hand half-migrated data to consumers.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { asRawClient, insertOne, selectMany } from "../../db/query";
import { integer as pgInteger, table as pgTable, text as pgText } from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildEntityTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import type { StoredEvent } from "../../event-store";
import { rebuildProjection } from "../../pipeline";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "../../stack";
import { append, createEventsTable } from "../index";
import { upcastStoredEvent } from "../upcaster";

// --- Fixture entity + projection table ---

const orderEntity = createEntity({
  table: "read_upcast_orders",
  fields: {
    customer: createTextField({ required: true }),
  },
});
const orderTable = buildEntityTable("upcast-order", orderEntity);

// Projection stores the UPCAST view: the v3 shape expects `totalCents` (int)
// even though the earliest writes might have stored `totalEuros` (string).
const orderSummaryTable = pgTable("read_upcast_order_summary", {
  orderId: pgText("order_id").primaryKey(),
  tenantId: pgText("tenant_id").notNull(),
  totalCents: pgInteger("total_cents").notNull(),
  currency: pgText("currency").notNull(),
});

// --- Feature: version 3 event with v1→v2 and v2→v3 migrations registered ---

const orderFeature = defineFeature("upcastshop", (r) => {
  r.entity("upcast-order", orderEntity);

  // v3 shape: { totalCents: int, currency: string }
  const orderPriced = r.defineEvent(
    "priced",
    z.object({ totalCents: z.number().int(), currency: z.string() }),
    { version: 3 },
  );

  // v1 → v2: renamed totalEuros → total (kept as string for this step)
  r.eventMigration("priced", 1, 2, (payload) => {
    const p = payload as { totalEuros: string };
    return { total: p.totalEuros, currency: "EUR" };
  });
  // v2 → v3: parse "total" string into integer cents
  r.eventMigration("priced", 2, 3, (payload) => {
    const p = payload as { total: string; currency: string };
    const euros = Number.parseFloat(p.total);
    return { totalCents: Math.round(euros * 100), currency: p.currency };
  });

  r.projection({
    name: "order-summary",
    source: "upcast-order",
    table: orderSummaryTable,
    apply: {
      [orderPriced.name]: async (event, tx) => {
        const p = event.payload as { totalCents: number; currency: string };
        await asRawClient(tx).unsafe(
          `INSERT INTO "read_upcast_order_summary" (order_id, tenant_id, total_cents, currency) VALUES ($1, $2, $3, $4) ON CONFLICT (order_id) DO UPDATE SET total_cents = $3, currency = $4`,
          [event.aggregateId, event.tenantId, p.totalCents, p.currency],
        );
      },
    },
  });
});

// --- Test scaffolding ---

let testDb: TestDb;
let tdb: TenantDb;
const admin = TestUsers.admin;
const registry = createRegistry([orderFeature]);
const qualifiedProjectionName = "upcastshop:projection:order-summary";
const orderExecutor = createEventStoreExecutor(orderTable, orderEntity, {
  entityName: "upcast-order",
});

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, orderEntity, "upcast-order");
  await createEventsTable(testDb.db);
  const { createProjectionStateTable } = await import("../../pipeline");
  await createProjectionStateTable(testDb.db);
  await unsafePushTables(testDb.db, { upcastOrderSummary: orderSummaryTable });
  tdb = createTenantDb(testDb.db, admin.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_upcast_orders, read_upcast_order_summary, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

// --- Tests ---

describe("upcaster: in-memory transform chain", () => {
  test("v1 payload walks v1→v2→v3 before reaching a consumer", async () => {
    const upcasters = registry.getEventUpcasters();
    const raw: StoredEvent = {
      id: "1",
      aggregateId: "00000000-0000-4000-8000-000000000001",
      aggregateType: "upcast-order",
      tenantId: admin.tenantId,
      version: 1,
      type: "upcastshop:event:priced",
      eventVersion: 1,
      payload: { totalEuros: "19.99" },
      metadata: { userId: admin.id },
      createdAt: Temporal.Now.instant(),
      createdBy: admin.id,
    };

    const upcast = await upcastStoredEvent(raw, upcasters, {
      db: testDb.db,
      tenantId: admin.tenantId,
    });

    expect(upcast.eventVersion).toBe(3);
    expect(upcast.payload).toEqual({ totalCents: 1999, currency: "EUR" });
  });

  test("v2 payload only needs v2→v3 step — chain short-circuits per stored version", async () => {
    const upcasters = registry.getEventUpcasters();
    const raw: StoredEvent = {
      id: "2",
      aggregateId: "00000000-0000-4000-8000-000000000002",
      aggregateType: "upcast-order",
      tenantId: admin.tenantId,
      version: 1,
      type: "upcastshop:event:priced",
      eventVersion: 2,
      payload: { total: "5.00", currency: "USD" },
      metadata: { userId: admin.id },
      createdAt: Temporal.Now.instant(),
      createdBy: admin.id,
    };

    const upcast = await upcastStoredEvent(raw, upcasters, {
      db: testDb.db,
      tenantId: admin.tenantId,
    });

    expect(upcast.eventVersion).toBe(3);
    expect(upcast.payload).toEqual({ totalCents: 500, currency: "USD" });
  });

  test("already-current events pass through unchanged — fast path", async () => {
    const upcasters = registry.getEventUpcasters();
    const raw: StoredEvent = {
      id: "3",
      aggregateId: "00000000-0000-4000-8000-000000000003",
      aggregateType: "upcast-order",
      tenantId: admin.tenantId,
      version: 1,
      type: "upcastshop:event:priced",
      eventVersion: 3,
      payload: { totalCents: 7777, currency: "CHF" },
      metadata: { userId: admin.id },
      createdAt: Temporal.Now.instant(),
      createdBy: admin.id,
    };

    const upcast = await upcastStoredEvent(raw, upcasters, {
      db: testDb.db,
      tenantId: admin.tenantId,
    });

    expect(upcast).toBe(raw); // identity — no rebuild allocated
  });

  test("unknown event types pass through unchanged", async () => {
    const upcasters = registry.getEventUpcasters();
    const raw: StoredEvent = {
      id: "4",
      aggregateId: "00000000-0000-4000-8000-000000000004",
      aggregateType: "upcast-order",
      tenantId: admin.tenantId,
      version: 1,
      type: "some:event:never-declared",
      eventVersion: 1,
      payload: { whatever: true },
      metadata: { userId: admin.id },
      createdAt: Temporal.Now.instant(),
      createdBy: admin.id,
    };

    const upcast = await upcastStoredEvent(raw, upcasters, {
      db: testDb.db,
      tenantId: admin.tenantId,
    });

    expect(upcast).toBe(raw);
  });
});

describe("upcaster: projection rebuild walks the chain on replay", () => {
  test("rebuild produces current-shape projection state from mixed v1/v2/v3 events", async () => {
    const ord1 = "00000000-0000-4000-8000-00000000aaaa";
    const ord2 = "00000000-0000-4000-8000-00000000bbbb";
    const ord3 = "00000000-0000-4000-8000-00000000cccc";

    // Seed the entity rows so the FK-less projection stays readable even if
    // future tests add FKs; insert directly, the executor is overkill here.
    await orderExecutor.create({ customer: "c1" }, admin, tdb);
    await orderExecutor.create({ customer: "c2" }, admin, tdb);
    await orderExecutor.create({ customer: "c3" }, admin, tdb);

    // Append three "priced" events at three different schema versions. The
    // projection apply is only written against v3 — without upcasting, the
    // v1 + v2 events would crash or produce garbage.
    await append(testDb.db, {
      aggregateId: ord1,
      aggregateType: "upcast-order",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: "upcastshop:event:priced",
      eventVersion: 1,
      payload: { totalEuros: "10.00" },
      metadata: { userId: admin.id },
    });
    await append(testDb.db, {
      aggregateId: ord2,
      aggregateType: "upcast-order",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: "upcastshop:event:priced",
      eventVersion: 2,
      payload: { total: "25.50", currency: "USD" },
      metadata: { userId: admin.id },
    });
    await append(testDb.db, {
      aggregateId: ord3,
      aggregateType: "upcast-order",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: "upcastshop:event:priced",
      eventVersion: 3,
      payload: { totalCents: 9900, currency: "CHF" },
      metadata: { userId: admin.id },
    });

    const result = await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
    });
    expect(result.eventsProcessed).toBe(3);

    const rows = await selectMany(testDb.db, orderSummaryTable);

    // Ordered by orderId → ord1 (10€ = 1000¢), ord2 ($25.50 = 2550¢), ord3 (9900¢)
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.orderId, r]));
    expect(byId.get(ord1)).toMatchObject({ totalCents: 1000, currency: "EUR" });
    expect(byId.get(ord2)).toMatchObject({ totalCents: 2550, currency: "USD" });
    expect(byId.get(ord3)).toMatchObject({ totalCents: 9900, currency: "CHF" });
  });
});

describe("upcaster: async (Marten AsyncOnlyEventUpcaster — DB-Lookups)", () => {
  test("async transform with ctx.db lookup walks chain via projection rebuild", async () => {
    // Reference data table that the async upcaster looks up — simulates the
    // typical case "v2 needs to enrich payload with current snapshot of a
    // reference dataset". We seed a known row and assert the rebuilt
    // projection has the enriched value.
    const customerSegments = pgTable("upcast_async_customer_segments", {
      customerId: pgText("customer_id").primaryKey(),
      segment: pgText("segment").notNull(),
    });
    await unsafePushTables(testDb.db, { upcastAsyncCustomerSegments: customerSegments });
    await insertOne(testDb.db, customerSegments, { customerId: "c-async-1", segment: "PREMIUM" });

    const asyncSummary = pgTable("upcast_async_summary", {
      orderId: pgText("order_id").primaryKey(),
      customerId: pgText("customer_id").notNull(),
      segment: pgText("segment").notNull(),
    });
    await unsafePushTables(testDb.db, { upcastAsyncSummary: asyncSummary });

    // Feature with async upcaster v1 → v2: enrich payload with segment from DB.
    const asyncFeature = defineFeature("upcastasync", (r) => {
      r.entity("upcast-async-order", orderEntity);
      const placed = r.defineEvent(
        "placed",
        z.object({ customerId: z.string(), segment: z.string() }),
        { version: 2 },
      );

      r.eventMigration("placed", 1, 2, async (payload, ctx) => {
        const p = payload as { customerId: string };
        const [row] = await selectMany(ctx.db, customerSegments, { customerId: p.customerId });
        return {
          customerId: p.customerId,
          segment: (row as { segment?: string } | undefined)?.segment ?? "UNKNOWN",
        };
      });

      r.projection({
        name: "async-summary",
        source: "upcast-async-order",
        table: asyncSummary,
        apply: {
          [placed.name]: async (event, tx) => {
            const p = event.payload as { customerId: string; segment: string };
            await insertOne(tx, asyncSummary, {
              orderId: event.aggregateId,
              customerId: p.customerId,
              segment: p.segment,
            });
          },
        },
      });
    });

    const asyncRegistry = createRegistry([asyncFeature]);

    // Stream: one v1 event without segment + one v2 event with segment.
    // The upcaster must lift v1 to v2 via DB lookup on customer_segments.
    const orderId1 = "00000000-0000-4000-8000-00000000ddd1";
    const orderId2 = "00000000-0000-4000-8000-00000000ddd2";
    await append(testDb.db, {
      aggregateId: orderId1,
      aggregateType: "upcast-async-order",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: "upcastasync:event:placed",
      eventVersion: 1,
      payload: { customerId: "c-async-1" },
      metadata: { userId: admin.id },
    });
    await append(testDb.db, {
      aggregateId: orderId2,
      aggregateType: "upcast-async-order",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: "upcastasync:event:placed",
      eventVersion: 2,
      payload: { customerId: "c-async-2", segment: "STANDARD" },
      metadata: { userId: admin.id },
    });

    const result = await rebuildProjection("upcastasync:projection:async-summary", {
      db: testDb.db,
      registry: asyncRegistry,
    });
    expect(result.eventsProcessed).toBe(2);

    const rows = await selectMany(testDb.db, asyncSummary);
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r) => [r.orderId, r]));
    // v1 → v2 via async DB lookup → segment from customer_segments.
    expect(byId.get(orderId1)?.segment).toBe("PREMIUM");
    // v2 already current → passes through unchanged.
    expect(byId.get(orderId2)?.segment).toBe("STANDARD");
  });
});

describe("upcaster: boot-time validation", () => {
  test("defineEvent with version=N and only partial migrations fails at registry build", () => {
    const incomplete = defineFeature("holes", (r) => {
      r.entity("hole-order", orderEntity);
      r.defineEvent("bad", z.object({ v3: z.string() }), { version: 3 });
      // Only 1→2 registered — the 2→3 gap must be rejected.
      r.eventMigration("bad", 1, 2, (p) => p);
    });
    expect(() => createRegistry([incomplete])).toThrow(/v2.*v3|covers the step v2/);
  });

  test("migration declared but no defineEvent → rejected", () => {
    const orphan = defineFeature("orphans", (r) => {
      r.entity("orph-order", orderEntity);
      r.eventMigration("ghost", 1, 2, (p) => p);
    });
    expect(() => createRegistry([orphan])).toThrow(/no r\.defineEvent/i);
  });

  test("migration toVersion > defineEvent version → rejected", () => {
    const future = defineFeature("future", (r) => {
      r.entity("future-order", orderEntity);
      r.defineEvent("early", z.object({ x: z.number() }), { version: 1 });
      r.eventMigration("early", 1, 2, (p) => p);
    });
    expect(() => createRegistry([future])).toThrow(/declares only version 1/);
  });

  test("non-contiguous (1→2 and 3→4 without 2→3) → rejected", () => {
    const gaps = defineFeature("gaps", (r) => {
      r.entity("gap-order", orderEntity);
      r.defineEvent("jumpy", z.object({ v: z.number() }), { version: 4 });
      r.eventMigration("jumpy", 1, 2, (p) => p);
      r.eventMigration("jumpy", 3, 4, (p) => p);
    });
    expect(() => createRegistry([gaps])).toThrow(/v2.*v3|covers the step v2/);
  });
});

describe("upcaster: registrar input validation", () => {
  test("r.eventMigration rejects multi-step jumps", () => {
    expect(() =>
      defineFeature("bigstep", (r) => {
        r.entity("bigstep-order", orderEntity);
        r.defineEvent("biz", z.object({ x: z.number() }), { version: 3 });
        r.eventMigration("biz", 1, 3, (p) => p);
      }),
    ).toThrow(/single-step/);
  });

  test("r.eventMigration rejects duplicate step", () => {
    expect(() =>
      defineFeature("dupestep", (r) => {
        r.entity("dup-order", orderEntity);
        r.defineEvent("dup", z.object({ x: z.number() }), { version: 2 });
        r.eventMigration("dup", 1, 2, (p) => p);
        r.eventMigration("dup", 1, 2, (p) => p);
      }),
    ).toThrow(/already registered/);
  });

  test("r.defineEvent rejects non-positive version", () => {
    expect(() =>
      defineFeature("badver", (r) => {
        r.entity("badver-order", orderEntity);
        r.defineEvent("neg", z.object({ x: z.number() }), { version: 0 });
      }),
    ).toThrow(/positive integer/);
  });
});
