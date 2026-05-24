// Runde 2 — correlationId + causationId propagation.
//
// Claims pinned here:
//   1. Root HTTP request without x-correlation-id → correlationId == requestId,
//      causationId absent.
//   2. Root with x-correlation-id header → correlationId == header value,
//      stamped on every event the request writes (CRUD + ctx.appendEvent).
//   3. The event-dispatcher wraps MSP-apply in requestContext.run so downstream
//      writes from the apply inherit correlationId and set causationId to the
//      triggering event.id.
//
// Note on MSP → new events: this test predates Runde 3 / C.2b. Claim 3 is
// observable via `requestContext.get()` inside the apply — the wrap carries
// the right values even when the apply doesn't call ctx.appendEvent.
// The active propagation into cascaded writes is covered by
// msp-multi-hop.integration.ts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { requestContext } from "../../api/request-context";
import { selectMany } from "../../bun-db/query";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { eventsTable } from "../../event-store";
import { setupBunTestStack, type BunTestStack } from "../../bun-db/__tests__/bun-test-stack";
import {
  resetEventStore,
  TestUsers,
  unsafeCreateEntityTable } from "../../stack";

// --- Feature ---

const orderEntity = createEntity({
  table: "read_causation_orders",
  fields: {
    item: createTextField({ required: true }),
  },
});

const orderTable = buildEntityTable("causation-order", orderEntity);

// MSP-apply observation sink — every apply run pushes its reqCtx snapshot
// here so the tests can assert what the event-dispatcher wrapped it with.
type ReqCtxSnapshot = {
  readonly forEventId: string;
  readonly correlationId: string | undefined;
  readonly causationId: string | undefined;
};
const applyObservations: ReqCtxSnapshot[] = [];

const causationFeature = defineFeature("causation", (r) => {
  r.entity("causation-order", orderEntity);

  const placed = r.defineEvent("placed", z.object({ orderId: z.uuid() }));

  const orderExecutor = createEventStoreExecutor(orderTable, orderEntity, {
    entityName: "causation-order",
  });

  r.writeHandler(
    "order:place",
    z.object({ item: z.string() }),
    async (event, ctx) => {
      const created = await orderExecutor.create({ item: event.payload.item }, event.user, ctx.db);
      if (!created.isSuccess) return created;
      await ctx.unsafeAppendEvent({
        aggregateId: String(created.data.id),
        aggregateType: "causation-order",
        type: placed.name,
        payload: { orderId: String(created.data.id) },
      });
      return created;
    },
    { access: { roles: ["Admin"] } },
  );

  // Observation-only MSP — records what the dispatcher's requestContext.run
  // wrap set for each event. Proves that the wrap is live and carries the
  // triggering event's id as causationId.
  r.multiStreamProjection({
    name: "observer",
    apply: {
      [placed.name]: async (event) => {
        const ctx = requestContext.get();
        applyObservations.push({
          forEventId: String(event["id"]),
          correlationId: ctx?.correlationId,
          causationId: ctx?.causationId,
        });
      },
    },
  });
});

// --- Stack ---

let stack: BunTestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupBunTestStack({
    features: [causationFeature],
    systemHooks: [],
  });
  await unsafeCreateEntityTable(stack.db, orderEntity, "causation-order");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  applyObservations.length = 0;
  await resetEventStore(stack, ["read_causation_orders"]);
});

// --- Helpers ---

async function eventsByType(type: string) {
  const rows = await selectMany(stack.db, eventsTable);
  return rows.filter((r: Record<string, unknown>) => r["type"] === type);
}

// --- Tests ---

describe("Runde 2 — correlationId on root HTTP request", () => {
  test("no x-correlation-id: correlationId mirrors requestId, causationId absent", async () => {
    await stack.http.writeOk("causation:write:order:place", { item: "widget" }, admin);

    const [placedEvent] = await eventsByType("causation:event:placed");
    expect(placedEvent).toBeDefined();
    const meta = placedEvent?.["metadata"] as {
      requestId?: string;
      correlationId?: string;
      causationId?: string;
    };
    // Default: correlationId == requestId so single-call tracing works
    // without any client co-operation.
    expect(meta.correlationId).toBeDefined();
    expect(meta.requestId).toBe(meta.correlationId);
    expect(meta.causationId).toBeUndefined();
  });

  test("with x-correlation-id header: every event this request writes carries the header value", async () => {
    const res = await stack.http.writeWithHeaders(
      "causation:write:order:place",
      { item: "sprocket" },
      admin,
      { "X-Correlation-ID": "test-chain-abc123" },
    );
    expect(res.status).toBe(200);

    // The handler writes TWO events: one CRUD (causationOrder.created) and
    // one domain (causation:event:placed). Both share the correlationId.
    const crudEvent = (await eventsByType("causation-order.created"))[0];
    const placedEvent = (await eventsByType("causation:event:placed"))[0];

    expect((crudEvent?.["metadata"] as { correlationId?: string })?.correlationId).toBe(
      "test-chain-abc123",
    );
    expect((placedEvent?.["metadata"] as { correlationId?: string })?.correlationId).toBe(
      "test-chain-abc123",
    );
  });

  test("response echoes x-correlation-id back in the same header", async () => {
    const res = await stack.http.writeWithHeaders(
      "causation:write:order:place",
      { item: "rotor" },
      admin,
      { "X-Correlation-ID": "echo-me-xyz" },
    );
    expect(res.headers.get("x-correlation-id")).toBe("echo-me-xyz");
  });
});

describe("Runde 2 — event-dispatcher propagates correlation + causation to MSP-apply", () => {
  test("MSP-apply sees the triggering event.id as causationId and inherits correlationId", async () => {
    // Root write with a known correlation token.
    await stack.http.writeWithHeaders("causation:write:order:place", { item: "gasket" }, admin, {
      "X-Correlation-ID": "msp-chain-token",
    });

    // Drain the dispatcher — MSP-apply fires, pushes its reqCtx snapshot.
    await stack.eventDispatcher?.runOnce();

    // Find the placed event by row id (BigInt). Its id is what the MSP
    // should have seen as causationId.
    const [placedEvent] = await eventsByType("causation:event:placed");
    expect(placedEvent).toBeDefined();
    const placedId = String(placedEvent?.["id"]);

    // Observation recorded inside the MSP apply.
    expect(applyObservations).toHaveLength(1);
    const obs = applyObservations[0];
    expect(obs?.forEventId).toBe(placedId);
    // Correlation inherited from the triggering event.
    expect(obs?.correlationId).toBe("msp-chain-token");
    // Causation = the id of the event that triggered this apply.
    expect(obs?.causationId).toBe(placedId);
  });
});
