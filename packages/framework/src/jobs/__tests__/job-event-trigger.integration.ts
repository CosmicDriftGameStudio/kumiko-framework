import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildServer, type JwtHelper } from "../../api";
import { createRegistry, defineFeature, type SessionUser } from "../../engine";
import { createTestDb, createTestRedis, type TestDb, type TestRedis, TestUsers } from "../../stack";
import { waitFor } from "../../testing";
import { createJobRunner, type JobRunner } from "../job-runner";

// --- Track job executions ---

const jobExecutions: Array<{ name: string; payload: Record<string, unknown> }> = [];

// --- Features ---

// Feature A: has a write handler "orders:create"
const ordersFeature = defineFeature("orders", (r) => {
  r.writeHandler(
    "orders:create",
    z.object({ product: z.string(), amount: z.number() }),
    async (event) => {
      return {
        isSuccess: true,
        data: { id: 1, product: event.payload.product, amount: event.payload.amount },
      };
    },
    { access: { openToAll: true } },
  );
});

// Feature B: has a job that triggers on "orders:write:orders:create" (prefixed)
const notificationsFeature = defineFeature("notifications", (r) => {
  r.job(
    "sendOrderConfirmation",
    { trigger: { on: "orders:write:orders:create" } },
    async (payload) => {
      jobExecutions.push({ name: "notifications:job:send-order-confirmation", payload });
    },
  );
});

// Feature C: has ANOTHER job on the same event — both should fire
const analyticsFeature = defineFeature("analytics", (r) => {
  // Dummy handler so the trackUser job trigger has a valid target
  r.writeHandler(
    "users:create",
    z.object({}),
    async () => ({
      isSuccess: true as const,
      data: null,
    }),
    { access: { openToAll: true } },
  );

  r.job("trackOrder", { trigger: { on: "orders:write:orders:create" } }, async (payload) => {
    jobExecutions.push({ name: "analytics:job:track-order", payload });
  });

  // Job on a different event — should NOT fire on orders.create
  r.job("trackUser", { trigger: { on: "analytics:write:users:create" } }, async (payload) => {
    jobExecutions.push({ name: "analytics:job:track-user", payload });
  });
});

// --- Setup ---

let testDb: TestDb;
let testRedis: TestRedis;
let app: Hono;
let jwt: JwtHelper;
let jobRunner: JobRunner;

const adminUser = TestUsers.admin;
const JWT_SECRET = "event-trigger-test-secret-minimum-32-chars!!";

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();

  const registry = createRegistry([ordersFeature, notificationsFeature, analyticsFeature]);
  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;

  jobRunner = createJobRunner({
    registry,
    context: {},
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-event-trigger-test-${Date.now()}`,
  });

  const server = buildServer({
    registry,
    context: {},
    jwtSecret: JWT_SECRET,
    dispatcherOptions: { jobRunner },
  });
  app = server.app;
  jwt = server.jwt;

  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

// --- Helpers ---

async function writeApi(user: SessionUser, type: string, payload: unknown) {
  const token = await jwt.sign(user);
  const res = await app.request("/api/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, payload }),
  });
  return res.json();
}

// --- Tests ---

describe("event trigger: write handler fires matching jobs", () => {
  test("orders.create triggers both notification and analytics jobs", async () => {
    jobExecutions.length = 0;

    const result = await writeApi(adminUser, "orders:write:orders:create", {
      product: "Widget",
      amount: 3,
    });
    expect(result.isSuccess).toBe(true);

    // Wait for BullMQ to process
    await waitFor(() => {
      const notification = jobExecutions.find(
        (e) => e.name === "notifications:job:send-order-confirmation",
      );
      const analytics = jobExecutions.find((e) => e.name === "analytics:job:track-order");

      expect(notification).toBeDefined();
      expect(notification?.payload["product"]).toBe("Widget");
      expect(notification?.payload["amount"]).toBe(3);

      expect(analytics).toBeDefined();
      expect(analytics?.payload["product"]).toBe("Widget");
    });
  });

  test("unrelated jobs do NOT fire", async () => {
    // analytics.trackUser listens on "users:create", not "orders:create"
    const trackUser = jobExecutions.find((e) => e.name === "analytics:job:track-user");
    expect(trackUser).toBeUndefined();
  });

  test("multiple orders each trigger jobs independently", async () => {
    jobExecutions.length = 0;

    await writeApi(adminUser, "orders:write:orders:create", { product: "A", amount: 1 });
    await writeApi(adminUser, "orders:write:orders:create", { product: "B", amount: 2 });

    await waitFor(() => {
      const notifications = jobExecutions.filter(
        (e) => e.name === "notifications:job:send-order-confirmation",
      );
      expect(notifications.length).toBe(2);

      const products = notifications.map((e) => e.payload["product"]);
      expect(products).toContain("A");
      expect(products).toContain("B");
    });
  });
});
