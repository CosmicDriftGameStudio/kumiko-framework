// Cross-Feature Reactions Sample — Integration Test
//
// Proves:
//   1. ctx.appendEvent persists the domain event into the events-table
//      inside the same TX as the business write, on the aggregate's own
//      stream (aggregateType = "pubsub-order", not the legacy "pubsub").
//   2. The event-dispatcher picks it up and invokes the
//      r.multiStreamProjection handler at-least-once, with event.tenantId
//      + payload intact.
//   3. The handler is a regular async function — no timers, no magic
//      callbacks. runOnce() drains deterministically.

import { eventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/stack";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { capturedEvents, orderEntity, pubsubOrderFeature } from "../feature";

let stack: TestStack;

const customer = createTestUser({ roles: ["Customer"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [pubsubOrderFeature] });
  await createEntityTable(stack.db, orderEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  capturedEvents.length = 0;
  stack.events.reset();
  // Reset events + consumer cursors so each test starts from a clean log.
  await resetEventStore(stack, ["read_sample_pubsub_orders"]);
});

describe("cross-feature reactions via ctx.appendEvent + r.multiStreamProjection", () => {
  test("write commits → event on aggregate stream → MSP handler receives it", async () => {
    const data = await stack.http.writeOk(
      "pubsub-orders:write:order:place",
      { customer: "Alice", product: "Widget" },
      customer,
    );
    const orderId = String(data["id"]);

    // The event row is committed alongside the order row. It lives on the
    // order's OWN stream now — aggregateType "pubsub-order", version 2
    // (auto "created" is v1, domain "order-placed" is v2).
    const domainEvents = await stack.db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.aggregateType, "pubsub-order"),
          eq(eventsTable.type, "pubsub-orders:event:order-placed"),
        ),
      );
    expect(domainEvents).toHaveLength(1);
    expect(domainEvents[0]?.aggregateId).toBe(orderId);
    expect(domainEvents[0]?.version).toBeGreaterThan(1);
    expect(domainEvents[0]?.payload).toMatchObject({
      id: orderId,
      customer: "Alice",
      product: "Widget",
    });
    expect(domainEvents[0]?.tenantId).toBe(customer.tenantId);

    // The dispatcher is built but not started in tests. runOnce drains
    // deterministically — no timer-induced flakiness.
    await stack.eventDispatcher?.runOnce();

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0]).toMatchObject({
      type: "pubsub-orders:event:order-placed",
      payload: { id: orderId, customer: "Alice", product: "Widget" },
      tenantId: customer.tenantId,
    });
  });

  test("MSP is not invoked when the write rolls back (no half-emitted events)", async () => {
    // An invalid write (missing required fields) fails Zod validation
    // before any DB mutation. No event row, no MSP invocation — the
    // appendEvent would have run in the same TX, so the rollback takes
    // it with.
    await stack.http.writeErr("pubsub-orders:write:order:place", { customer: "" }, customer);

    const domainEvents = await stack.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.type, "pubsub-orders:event:order-placed"));
    expect(domainEvents).toHaveLength(0);

    await stack.eventDispatcher?.runOnce();
    expect(capturedEvents).toHaveLength(0);
  });

  test("multiple appendEvents → events delivered in id-order, at-least-once", async () => {
    for (const name of ["Bob", "Carol", "Dave"]) {
      await stack.http.writeOk(
        "pubsub-orders:write:order:place",
        { customer: name, product: "X" },
        customer,
      );
    }

    await stack.eventDispatcher?.runOnce();

    expect(capturedEvents.map((e) => e.payload.customer)).toEqual(["Bob", "Carol", "Dave"]);
  });
});
