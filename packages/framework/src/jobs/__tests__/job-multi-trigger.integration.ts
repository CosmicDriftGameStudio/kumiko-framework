// Runtime-Test für r.job multi-trigger (Item B-Followup):
// pinst dass ein Job mit Array-Trigger für ALLE deklarierten Trigger
// feuert und payload._triggerName den korrekten Namen trägt.
//
// Unit-Tests in engine.test.ts decken nur Boot-Behavior ab (Akzeptanz +
// Validator-Reject). Hier prüfen wir die runtime-dispatch-Pfade durch
// einen echten BullMQ-Worker.

import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { buildServer, type JwtHelper } from "../../api";
import { createRegistry, defineFeature, type SessionUser } from "../../engine";
import { createTestDb, createTestRedis, type TestDb, type TestRedis, TestUsers } from "../../stack";
import { waitFor } from "../../testing";
import { createJobRunner, type JobRunner } from "../job-runner";

const jobExecutions: Array<{ trigger: string; payload: Record<string, unknown> }> = [];

// Feature mit zwei Write-Handlern + einem Job der auf beide hört.
// Ein Job-Body, mehrere Trigger — der DRY-Fall den r.job multi-trigger
// adressiert.
const orderFeature = defineFeature("multi", (r) => {
  r.writeHandler(
    "order:open",
    z.object({ id: z.string() }),
    async (event) => ({ isSuccess: true, data: { id: event.payload.id } }),
    { access: { openToAll: true } },
  );
  r.writeHandler(
    "order:cancel",
    z.object({ id: z.string() }),
    async (event) => ({ isSuccess: true, data: { id: event.payload.id } }),
    { access: { openToAll: true } },
  );
  r.job(
    "fanout",
    {
      trigger: {
        on: ["multi:write:order:open", "multi:write:order:cancel"],
      },
    },
    async (payload, ctx) => {
      // ctx.triggerName ist die idiomatische API: bei Multi-Trigger-Jobs
      // sagt das Feld dem Handler welcher der N Trigger gefeuert hat.
      jobExecutions.push({ trigger: ctx.triggerName ?? "<missing>", payload });
    },
  );
});

let testDb: TestDb;
let testRedis: TestRedis;
let app: Hono;
let jwt: JwtHelper;
let jobRunner: JobRunner;

const adminUser = TestUsers.admin;
const JWT_SECRET = "multi-trigger-test-secret-minimum-32-chars!!";

beforeAll(async () => {
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
