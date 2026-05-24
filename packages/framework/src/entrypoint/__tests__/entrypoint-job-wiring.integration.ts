// Regression test for Welle 2.6.b — the `mergeDispatcherOptions` plumbing.
//
// The command-dispatcher (packages/framework/src/pipeline/dispatcher.ts:997)
// fires `jobRunner.handleEvent` as an afterCommit-hook. Without a jobRunner
// reference IN the dispatcher's options, event-triggered jobs silently drop
// on every write. Welle 2.5 built the jobRunner in the entrypoint factory
// but never wired it in — welle 2.6.b closes that via mergeDispatcherOptions.
//
// `job-event-trigger.integration.ts` only covers the path when the CALLER
// hand-wires `dispatcherOptions: { jobRunner }`. This test pins the
// auto-wiring path that a real app boot uses (`createAllInOneEntrypoint`) —
// so a future refactor that drops the merge fails here instead of silently
// regressing to the Welle-2.5 state.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createRegistry, defineFeature } from "../../engine";
import { createArchivedStreamsTable, createEventsTable } from "../../event-store";
import { createEventConsumerStateTable } from "../../pipeline";
import { createTestDb, createTestRedis, type TestDb, type TestRedis, TestUsers } from "../../stack";
import { waitFor } from "../../testing";
import { createAllInOneEntrypoint } from "../index";

const jobRuns: Array<{ name: string; payload: Record<string, unknown> }> = [];

const wiringFeature = defineFeature("wiring", (r) => {
  r.writeHandler(
    "order:create",
    z.object({ sku: z.string() }),
    async (event) => ({
      isSuccess: true as const,
      data: { id: 1, sku: event.payload.sku },
    }),
    { access: { openToAll: true } },
  );
  r.job(
    "record-order",
    { trigger: { on: "wiring:write:order:create" }, runIn: "worker" },
    async (payload) => {
      jobRuns.push({ name: "wiring:job:record-order", payload });
    },
  );
});

// Mixed-lane feature: one worker-lane + one api-lane job triggered on the
// same event. The all-in-one process spins up both BullMQ workers (one per
// queue) and both must execute. Proves the two-runner construction in
// createAllInOneEntrypoint actually consumes both lanes — not just that
// enqueue routing works.
const mixedLaneFeature = defineFeature("mixed", (r) => {
  r.writeHandler(
    "ping",
    z.object({ msg: z.string() }),
    async (event) => ({
      isSuccess: true as const,
      data: { id: 1, msg: event.payload.msg },
    }),
    { access: { openToAll: true } },
  );
  r.job(
    "handle-on-worker",
    { trigger: { on: "mixed:write:ping" }, runIn: "worker" },
    async (payload) => {
      jobRuns.push({ name: "mixed:job:handle-on-worker", payload });
    },
  );
  r.job("handle-on-api", { trigger: { on: "mixed:write:ping" }, runIn: "api" }, async (payload) => {
    jobRuns.push({ name: "mixed:job:handle-on-api", payload });
  });
});

const JWT = "entrypoint-wiring-test-secret-must-be-32-chars!";
const adminUser = TestUsers.admin;

let testDb: TestDb;
let testRedis: TestRedis;

beforeAll(async () => {
  [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);
  await createEventsTable(testDb.db);
  await createArchivedStreamsTable(testDb.db);
  await createEventConsumerStateTable(testDb.db);
});

afterAll(async () => {
  await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
});

describe("createAllInOneEntrypoint auto-wires jobRunner into command-dispatcher", () => {
  test("event-triggered job runs end-to-end (HTTP write → afterCommit → BullMQ → handler)", async () => {
    jobRuns.length = 0;
    const registry = createRegistry([wiringFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const entry = createAllInOneEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
      queueNamePrefix: `wiring-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    await entry.start();
    try {
      const token = await entry.jwt.sign(adminUser);
      const res = await entry.app.request("/api/write", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: "wiring:write:order:create",
          payload: { sku: "W-1" },
        }),
      });
      const result = (await res.json()) as { isSuccess: boolean };
      expect(result.isSuccess).toBe(true);

      // If mergeDispatcherOptions ever stops wiring the jobRunner, the
      // afterCommit-hook at dispatcher.ts:997 becomes a no-op, the job
      // is never enqueued, and waitFor times out. That's the regression
      // this test is here to catch.
      await waitFor(() => {
        const run = jobRuns.find((e) => e.name === "wiring:job:record-order");
        expect(run).toBeDefined();
        expect(run?.payload["sku"]).toBe("W-1");
      });
    } finally {
      await entry.stop();
    }
  });

  test("all-in-one runs BOTH lane workers — api-lane + worker-lane jobs fire on the same event", async () => {
    jobRuns.length = 0;
    const registry = createRegistry([mixedLaneFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const entry = createAllInOneEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
      queueNamePrefix: `wiring-mixed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    await entry.start();
    try {
      const token = await entry.jwt.sign(adminUser);
      const res = await entry.app.request("/api/write", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: "mixed:write:ping", payload: { msg: "hi" } }),
      });
      const result = (await res.json()) as { isSuccess: boolean };
      expect(result.isSuccess).toBe(true);

      // Both jobs must fire: worker-lane runner picks kumiko-jobs-<prefix>-worker,
      // api-lane runner picks kumiko-jobs-<prefix>-api. If either BullMQ
      // worker failed to start (bug in the two-runner build in createAllInOne
      // Entrypoint), waitFor times out on the missing entry.
      await waitFor(() => {
        const workerRun = jobRuns.find((e) => e.name === "mixed:job:handle-on-worker");
        const apiRun = jobRuns.find((e) => e.name === "mixed:job:handle-on-api");
        expect(workerRun).toBeDefined();
        expect(apiRun).toBeDefined();
        expect(workerRun?.payload["msg"]).toBe("hi");
        expect(apiRun?.payload["msg"]).toBe("hi");
      });
    } finally {
      await entry.stop();
    }
  });
});
