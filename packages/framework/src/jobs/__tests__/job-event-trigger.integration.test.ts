import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature, emitEvent } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

// --- Track job executions ---

const jobExecutions: Array<{ name: string; payload: Record<string, unknown> }> = [];

const orderPlacedSchema = z.object({ product: z.string(), amount: z.number() });

// --- Features ---

// Feature A: a write handler that appends the "order-placed" event
const ordersFeature = defineFeature("orders", (r) => {
  const orderPlaced = r.defineEvent("order-placed", orderPlacedSchema, { piiFields: "none" });
  r.writeHandler({
    name: "orders:create",
    schema: orderPlacedSchema,
    handler: async (event, ctx) => {
      await emitEvent(ctx, orderPlaced, {
        aggregateId: crypto.randomUUID(),
        expectedVersion: 0,
        aggregateType: "order",
        payload: { product: event.payload.product, amount: event.payload.amount },
      });
      return {
        isSuccess: true,
        data: { id: 1, product: event.payload.product, amount: event.payload.amount },
      };
    },
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });

  // Short trigger name, qualified at boot against the job's own feature.
  r.job({
    name: "auditOrder",
    trigger: { on: "order-placed" },
    handler: async (payload) => {
      jobExecutions.push({ name: "orders:job:audit-order", payload });
    },
  });
});

// Feature B: has a job that triggers on the qualified "orders:event:order-placed"
const notificationsFeature = defineFeature("notifications", (r) => {
  r.job({
    name: "sendOrderConfirmation",
    trigger: { on: "orders:event:order-placed" },
    handler: async (payload) => {
      jobExecutions.push({ name: "notifications:job:send-order-confirmation", payload });
    },
  });
});

// Feature C: has ANOTHER job on the same event — both should fire
const analyticsFeature = defineFeature("analytics", (r) => {
  // Event nobody appends in these tests, so the trackUser job has a valid target
  r.defineEvent("user-created", z.object({}), { piiFields: "none" });

  r.job({
    name: "trackOrder",
    trigger: { on: "orders:event:order-placed" },
    handler: async (payload) => {
      jobExecutions.push({ name: "analytics:job:track-order", payload });
    },
  });

  // Job on a different event — should NOT fire on order-placed
  r.job({
    name: "trackUser",
    trigger: { on: "analytics:event:user-created" },
    handler: async (payload) => {
      jobExecutions.push({ name: "analytics:job:track-user", payload });
    },
  });
});

// --- Setup ---

let stack: TestStack;

const adminUser = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [ordersFeature, notificationsFeature, analyticsFeature],
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

// --- Tests ---

describe("event trigger: an appended event fires matching jobs", () => {
  test("orders:create triggers the notification, analytics and short-name audit jobs", async () => {
    jobExecutions.length = 0;

    await stack.http.writeOk(
      "orders:write:orders:create",
      { product: "Widget", amount: 3 },
      adminUser,
    );
    await stack.drainJobs();

    const notification = jobExecutions.find(
      (e) => e.name === "notifications:job:send-order-confirmation",
    );
    const analytics = jobExecutions.find((e) => e.name === "analytics:job:track-order");
    const audit = jobExecutions.find((e) => e.name === "orders:job:audit-order");

    expect(notification).toBeDefined();
    expect(notification?.payload["product"]).toBe("Widget");
    expect(notification?.payload["amount"]).toBe(3);

    expect(analytics).toBeDefined();
    expect(analytics?.payload["product"]).toBe("Widget");

    expect(audit?.payload["product"]).toBe("Widget");
  });

  test("unrelated jobs do NOT fire", async () => {
    // analytics.trackUser listens on "user-created", not "order-placed"
    const trackUser = jobExecutions.find((e) => e.name === "analytics:job:track-user");
    expect(trackUser).toBeUndefined();
  });

  test("multiple orders each trigger jobs independently", async () => {
    jobExecutions.length = 0;

    await stack.http.writeOk("orders:write:orders:create", { product: "A", amount: 1 }, adminUser);
    await stack.http.writeOk("orders:write:orders:create", { product: "B", amount: 2 }, adminUser);
    await stack.drainJobs();

    const notifications = jobExecutions.filter(
      (e) => e.name === "notifications:job:send-order-confirmation",
    );
    expect(notifications.length).toBe(2);

    const products = notifications.map((e) => e.payload["product"]);
    expect(products).toContain("A");
    expect(products).toContain("B");
  });
});
