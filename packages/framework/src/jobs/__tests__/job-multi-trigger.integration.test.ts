// Runtime test for r.job multi-trigger:
// proves that a job with an array trigger fires for ALL declared triggers
// and that payload._triggerName contains the correct name.
//
// Unit tests in engine.test.ts cover only boot behavior (acceptance +
// validator rejection). This test exercises the runtime-dispatch paths
// through a real BullMQ worker.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestRedis, type TestRedis } from "@cosmicdrift/kumiko-testing/stack";
import type { Hono } from "hono";
import * as z from "zod";
import { buildServer, type JwtHelper } from "../../api/index.ts";
import { type BunTestDb, createTestDb } from "../../db/__tests__/query/bun-test-db.ts";
import { createRegistry, defineFeature, type SessionUser } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { createJobRunner, type JobRunner } from "../job-runner.ts";

const jobExecutions: Array<{ trigger: string; payload: Record<string, unknown> }> = [];

// Feature with two write handlers and one job that listens to both.
// One job body with multiple triggers is the DRY case addressed by
// r.job multi-trigger.
const orderFeature = defineFeature("multi", (r) => {
  r.writeHandler({
    name: "order:open",
    schema: z.object({ id: z.string() }),
    handler: async (event) => ({ isSuccess: true, data: { id: event.payload.id } }),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.writeHandler({
    name: "order:cancel",
    schema: z.object({ id: z.string() }),
    handler: async (event) => ({ isSuccess: true, data: { id: event.payload.id } }),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.job(
    "fanout",
    {
      trigger: {
        on: ["multi:write:order:open", "multi:write:order:cancel"],
      },
    },
    async (payload, ctx) => {
      // ctx.triggerName is the idiomatic API: for multi-trigger jobs,
      // this field tells the handler which of the N triggers fired.
      jobExecutions.push({ trigger: ctx.triggerName ?? "<missing>", payload });
    },
  );
});

let testDb: BunTestDb;
let testRedis: TestRedis;
let app: Hono;
let jwt: JwtHelper;
let jobRunner: JobRunner;

const adminUser = TestUsers.admin;
const JWT_SECRET = "multi-trigger-test-secret-minimum-32-chars!!";

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  testRedis = await createTestRedis();

  const registry = createRegistry([orderFeature]);
  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;

  jobRunner = createJobRunner({
    registry,
    context: {},
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-multi-trigger-test-${Date.now()}`,
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

async function writeApi(user: SessionUser, type: string, payload: unknown) {
  const token = await jwt.sign(user);
  const res = await app.request("/api/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, payload }),
  });
  return res.json();
}

describe("r.job multi-trigger — runtime-dispatch", () => {
  test("Trigger 1 (order:open) → Job läuft mit ctx.triggerName=multi:write:order:open", async () => {
    jobExecutions.length = 0;

    const result = await writeApi(adminUser, "multi:write:order:open", { id: "o-1" });
    expect(result.isSuccess).toBe(true);

    await waitFor(() => {
      const exec = jobExecutions[0];
      expect(exec).toBeDefined();
      expect(exec?.trigger).toBe("multi:write:order:open");
      expect(exec?.payload["id"]).toBe("o-1");
    });
  });

  test("Trigger 2 (order:cancel) → derselbe Job läuft mit ctx.triggerName=multi:write:order:cancel", async () => {
    jobExecutions.length = 0;

    const result = await writeApi(adminUser, "multi:write:order:cancel", { id: "o-2" });
    expect(result.isSuccess).toBe(true);

    await waitFor(() => {
      const exec = jobExecutions[0];
      expect(exec).toBeDefined();
      expect(exec?.trigger).toBe("multi:write:order:cancel");
      expect(exec?.payload["id"]).toBe("o-2");
    });
  });

  test("Beide Trigger nacheinander → 2 Job-Läufe, jeweils mit korrektem ctx.triggerName", async () => {
    jobExecutions.length = 0;

    await writeApi(adminUser, "multi:write:order:open", { id: "a" });
    await writeApi(adminUser, "multi:write:order:cancel", { id: "b" });

    await waitFor(() => {
      expect(jobExecutions.length).toBe(2);
      const triggers = jobExecutions.map((e) => e.trigger).sort();
      expect(triggers).toEqual(["multi:write:order:cancel", "multi:write:order:open"]);
    });
  });
});
