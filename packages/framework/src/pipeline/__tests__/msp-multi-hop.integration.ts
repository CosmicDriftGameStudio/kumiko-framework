// Runde 3 / C.2b — MSP-apply ctx.appendEvent cascades (saga / process-manager).
//
// Claims pinned here:
//   1. MSP-apply receives an optional 3rd ctx arg with appendEvent + loadAggregate.
//   2. ctx.appendEvent from inside apply writes a follow-up event into the
//      CURRENT transaction on the aggregate stream the caller picks.
//   3. The follow-up event inherits correlationId from the triggering event
//      and records causationId = triggering event.id.
//   4. A second MSP reacting to the follow-up appends its own event, completing
//      a three-hop causal chain (order.placed → order.confirmed → order.shipped).
//   5. ctx.loadAggregate reads the triggering stream's full history.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { eventsTable } from "../../event-store";
import {
  createEntityTable,
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "../../testing";

// --- Feature ---

const orderEntity = createEntity({
  table: "read_mmh_orders",
  fields: {
    item: createTextField({ required: true }),
  },
});

const orderTable = buildDrizzleTable("mmhOrder", orderEntity);

// Snapshot what each MSP-apply observed via ctx.loadAggregate.
const confirmLoadCounts: number[] = [];

const mmhFeature = defineFeature("mmh", (r) => {
  r.entity("mmhOrder", orderEntity);

  const placed = r.defineEvent("placed", z.object({ orderId: z.uuid() }));
  const confirmed = r.defineEvent("confirmed", z.object({ orderId: z.uuid() }));
  const shipped = r.defineEvent("shipped", z.object({ orderId: z.uuid() }));

  const orderExecutor = createEventStoreExecutor(orderTable, orderEntity, {
    entityName: "mmhOrder",
  });

  r.writeHandler(
    "order:place",
    z.object({ item: z.string() }),
    async (event, ctx) => {
      const created = await orderExecutor.create({ item: event.payload.item }, event.user, ctx.db);
      if (!created.isSuccess) return created;
      await ctx.appendEvent({
        aggregateId: String(created.data.id),
        aggregateType: "mmhOrder",
        type: placed.name,
        payload: { orderId: String(created.data.id) },
      });
      return created;
    },
    { access: { roles: ["Admin"] } },
  );

  // Hop 1: placed → confirmed. Uses ctx.loadAggregate to observe the current
  // stream before deciding + ctx.appendEvent to cascade.
  r.multiStreamProjection({
    name: "confirm-on-placed",
    apply: {
      [placed.name]: async (event, _tx, ctx) => {
        if (!ctx) throw new Error("MSP-apply ctx missing — regression of C.2b wiring");
        const history = await ctx.loadAggregate(event.aggregateId);
        confirmLoadCounts.push(history.length);
        await ctx.appendEvent({
          aggregateId: event.aggregateId,
          aggregateType: "mmhOrder",
          type: confirmed.name,
          payload: { orderId: event.aggregateId },
        });
      },
    },
  });

  // Hop 2: confirmed → shipped.
  r.multiStreamProjection({
    name: "ship-on-confirmed",
    apply: {
      [confirmed.name]: async (event, _tx, ctx) => {
        if (!ctx) throw new Error("MSP-apply ctx missing — regression of C.2b wiring");
        await ctx.appendEvent({
          aggregateId: event.aggregateId,
          aggregateType: "mmhOrder",
          type: shipped.name,
          payload: { orderId: event.aggregateId },
        });
      },
    },
  });
});

// --- Stack ---

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [mmhFeature], systemHooks: [] });
  await createEntityTable(stack.db, orderEntity, "mmhOrder");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  confirmLoadCounts.length = 0;
  await resetEventStore(stack, ["read_mmh_orders"]);
});

// --- Helpers ---

async function postWrite(correlationId: string, item: string) {
  return stack.http.writeWithHeaders("mmh:write:order:place", { item }, admin, {
    "X-Correlation-ID": correlationId,
  });
}

async function drainUntilShipped(aggregateId: string, maxPasses = 10): Promise<void> {
  for (let i = 0; i < maxPasses; i++) {
    await stack.eventDispatcher?.runOnce();
    const rows = await stack.db.select().from(eventsTable);
    if (rows.some((r) => r.aggregateId === aggregateId && r.type === "mmh:event:shipped")) return;
  }
  throw new Error(`drainUntilShipped: never saw shipped event for ${aggregateId}`);
}

// --- Tests ---

describe("Runde 3 / C.2b — MSP-apply ctx cascades", () => {
  test("single-hop: apply appends a follow-up on the triggering aggregate", async () => {
    const res = await postWrite("hop-1", "widget");
    expect(res.status).toBe(200);

    await stack.eventDispatcher?.runOnce();

    const rows = await stack.db.select().from(eventsTable);
    const types = rows.map((r) => r.type).sort();
    // Order: CRUD create, placed, confirmed (hop 1 fired).
    expect(types).toContain("mmhOrder.created");
    expect(types).toContain("mmh:event:placed");
    expect(types).toContain("mmh:event:confirmed");
  });

  test("three-hop chain: all events share correlationId, causation traces placed→confirmed→shipped", async () => {
    await postWrite("chain-xyz", "rotor");

    // Find the aggregateId from the first placed event.
    await stack.eventDispatcher?.runOnce();
    const placedRow = (await stack.db.select().from(eventsTable)).find(
      (r) => r.type === "mmh:event:placed",
    );
    expect(placedRow).toBeDefined();
    const aggregateId = placedRow?.aggregateId as string;

    await drainUntilShipped(aggregateId);

    const rows = (await stack.db.select().from(eventsTable))
      .filter((r) => r.aggregateId === aggregateId)
      .sort((a, b) => Number(a.id - b.id));

    const placed = rows.find((r) => r.type === "mmh:event:placed");
    const confirmed = rows.find((r) => r.type === "mmh:event:confirmed");
    const shipped = rows.find((r) => r.type === "mmh:event:shipped");

    expect(placed).toBeDefined();
    expect(confirmed).toBeDefined();
    expect(shipped).toBeDefined();

    const placedMeta = placed?.metadata as {
      correlationId?: string;
      causationId?: string;
    };
    const confirmedMeta = confirmed?.metadata as {
      correlationId?: string;
      causationId?: string;
    };
    const shippedMeta = shipped?.metadata as {
      correlationId?: string;
      causationId?: string;
    };

    // All three carry the same correlationId.
    expect(placedMeta.correlationId).toBe("chain-xyz");
    expect(confirmedMeta.correlationId).toBe("chain-xyz");
    expect(shippedMeta.correlationId).toBe("chain-xyz");

    // Causation chain: placed is root; each later hop points back to the
    // event that triggered its MSP.
    expect(placedMeta.causationId).toBeUndefined();
    expect(confirmedMeta.causationId).toBe(String(placed?.id));
    expect(shippedMeta.causationId).toBe(String(confirmed?.id));
  });

  test("ctx.loadAggregate inside apply sees the stream as it was when the trigger event landed", async () => {
    await postWrite("load-chk", "sprocket");
    await stack.eventDispatcher?.runOnce();

    // The confirm-apply loads the stream on each invocation. At the time
    // the placed event fires, the stream has exactly 2 events: the CRUD
    // create + placed itself.
    expect(confirmLoadCounts).toEqual([2]);
  });

  test("tenant isolation: ctx.appendEvent writes into the triggering event's tenant", async () => {
    await postWrite("tenant-iso", "gear");
    await stack.eventDispatcher?.runOnce();

    // Every event written on this chain belongs to the admin's tenant.
    const rows = await stack.db.select().from(eventsTable);
    for (const row of rows) {
      expect(row.tenantId).toBe(admin.tenantId);
    }
  });
});
