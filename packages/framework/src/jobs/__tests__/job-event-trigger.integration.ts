import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { buildServer, type JwtHelper } from "../../api";
import { createRegistry, defineFeature } from "../../engine";
import type { PipelineUser } from "../../engine/types";
import { createTestDb, createTestRedis, type TestDb, type TestRedis } from "../../testing";
import { createJobRunner, type JobRunner } from "../job-runner";

// --- Track job executions ---

const jobExecutions: Array<{ name: string; payload: Record<string, unknown> }> = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Features ---

// Feature A: has a write handler "orders.create"
const ordersFeature = defineFeature("orders", (r) => {
  r.writeHandler(
    "orders.create",
    z.object({ product: z.string(), amount: z.number() }),
    async (event) => {
      return {
        isSuccess: true,
        data: { id: 1, product: event.payload.product, amount: event.payload.amount },
      };
    },
  );
});

// Feature B: has a job that triggers on "orders.create"
const notificationsFeature = defineFeature("notifications", (r) => {
  r.job("sendOrderConfirmation", { trigger: { on: "orders.create" } }, async (payload) => {
    jobExecutions.push({ name: "notifications.sendOrderConfirmation", payload });
  });
});

// Feature C: has ANOTHER job on the same event — both should fire
const analyticsFeature = defineFeature("analytics", (r) => {
  r.job("trackOrder", { trigger: { on: "orders.create" } }, async (payload) => {
    jobExecutions.push({ name: "analytics.trackOrder", payload });
  });

  // Job on a different event — should NOT fire on orders.create
  r.job("trackUser", { trigger: { on: "users.create" } }, async (payload) => {
    jobExecutions.push({ name: "analytics.trackUser", payload });
  });
});

// --- Setup ---

let testDb: TestDb;
let testRedis: TestRedis;
let app: Hono;
let jwt: JwtHelper;
let jobRunner: JobRunner;

const adminUser: PipelineUser = { id: 1, tenantId: 1, roles: ["Admin"] };
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
    queueName: `kumiko-event-trigger-test-${Date.now()}`,
  });

  const context = { jobRunner };

  const server = buildServer({
    registry,
    context,
    jwtSecret: JWT_SECRET,
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

async function writeApi(user: PipelineUser, type: string, payload: unknown) {
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

    const result = await writeApi(adminUser, "orders.create", {
      product: "Widget",
      amount: 3,
    });
    expect(result.isSuccess).toBe(true);

    // Wait for BullMQ to process
    await sleep(1500);

    // Both jobs should have fired
    const notification = jobExecutions.find(
      (e) => e.name === "notifications.sendOrderConfirmation",
    );
    const analytics = jobExecutions.find((e) => e.name === "analytics.trackOrder");

    expect(notification).toBeDefined();
    expect(notification?.payload["product"]).toBe("Widget");
    expect(notification?.payload["amount"]).toBe(3);

    expect(analytics).toBeDefined();
    expect(analytics?.payload["product"]).toBe("Widget");
  });

  test("unrelated jobs do NOT fire", async () => {
    // analytics.trackUser listens on "users.create", not "orders.create"
    const trackUser = jobExecutions.find((e) => e.name === "analytics.trackUser");
    expect(trackUser).toBeUndefined();
  });

  test("multiple orders each trigger jobs independently", async () => {
    jobExecutions.length = 0;

    await writeApi(adminUser, "orders.create", { product: "A", amount: 1 });
    await writeApi(adminUser, "orders.create", { product: "B", amount: 2 });

    await sleep(1500);

    const notifications = jobExecutions.filter(
      (e) => e.name === "notifications.sendOrderConfirmation",
    );
    expect(notifications.length).toBe(2);

    const products = notifications.map((e) => e.payload["product"]);
    expect(products).toContain("A");
    expect(products).toContain("B");
  });
});
