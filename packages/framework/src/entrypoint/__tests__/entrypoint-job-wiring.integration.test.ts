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
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { createRegistry, defineFeature } from "../../engine";
import { createArchivedStreamsTable, createEventsTable } from "../../event-store";
import { createNoopProvider, createPrometheusMeter } from "../../observability";
import { createEventConsumerStateTable } from "../../pipeline";
import { createTestRedis, type TestRedis, TestUsers } from "../../stack";
import { sleep, waitFor } from "../../testing";
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

let testDb: BunTestDb;
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

// Regression test for #1046 — createJobRunner is built from the caller's
// RAW context, BEFORE buildServer ever merges observability.tracer/meter
// into a context object of its own. Without threading the resolved
// provider into the job-runner's context too, `context.meter` stayed
// undefined, the queue-depth poller's `if (context.meter)` guard skipped
// silently, and `/metrics` showed the kumiko_job_queue_depth HELP/TYPE
// header but never a single data line — forever, with no error anywhere.
describe("createAllInOneEntrypoint — kumiko_job_queue_depth sees the SAME meter as buildServer (#1046)", () => {
  test("passing an explicit observability provider makes the queue-depth poller emit real data for BOTH lanes", async () => {
    const registry = createRegistry([wiringFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const meter = createPrometheusMeter();
    const observability = { ...createNoopProvider(), meter };
    const entry = createAllInOneEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
      queueNamePrefix: `wiring-qd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      observability,
    });
    await entry.start();
    try {
      // If the job-runner never saw this meter (the #1046 bug), the poller's
      // `if (context.meter)` guard skips entirely and no slots ever appear —
      // this assertion is the one that would have caught it.
      const snapshot = meter.snapshot().get("kumiko_job_queue_depth");
      expect(snapshot).toBeDefined();
      const workerWaiting = snapshot?.slots.find(
        (s) => s.labels?.["lane"] === "worker" && s.labels?.["state"] === "waiting",
      );
      const apiWaiting = snapshot?.slots.find(
        (s) => s.labels?.["lane"] === "api" && s.labels?.["state"] === "waiting",
      );
      expect(workerWaiting).toBeDefined();
      expect(apiWaiting).toBeDefined();
      // Same instance, not a coincidentally-equal one — proves buildServer's
      // internal registerStandardMetrics() and the job-runner's poller wrote
      // into the identical meter, not two disconnected Noop instances.
      expect(entry.observability.meter).toBe(meter);
      // BullMQ's fresh Worker connections are still settling right after
      // start() returns — stopping immediately races their own connection
      // teardown and throws an unrelated "Connection is closed" from
      // ioredis (same artifact documented in job-queue-depth.integration.
      // test.ts). Production runners live far longer than this.
      await sleep(50);
    } finally {
      await entry.stop();
    }
  });
});

// Regression test for #1253 — effectiveFeatures was wired into
// dispatcherOptions (command-dispatcher's feature-gate) but never merged
// into the job-runner's context. A job handler reading
// `context.effectiveFeatures?.(tenantId)` always saw undefined in prod.
const featuresSeenByJob: Array<ReadonlySet<string> | undefined> = [];

const featureGateJobFeature = defineFeature("featuregate", (r) => {
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
    "record-features",
    { trigger: { on: "featuregate:write:ping" }, runIn: "worker" },
    async (_payload, context) => {
      featuresSeenByJob.push(context.effectiveFeatures?.(adminUser.tenantId));
    },
  );
});

describe("createAllInOneEntrypoint — job context sees dispatcherOptions.effectiveFeatures (#1253)", () => {
  test("job handler reads the same effectiveFeatures resolver as the command-dispatcher's feature-gate", async () => {
    featuresSeenByJob.length = 0;
    const registry = createRegistry([featureGateJobFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const entry = createAllInOneEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
      queueNamePrefix: `wiring-features-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dispatcherOptions: {
        effectiveFeatures: () => new Set(["featuregate", "some-feature"]),
      },
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
        body: JSON.stringify({ type: "featuregate:write:ping", payload: { msg: "hi" } }),
      });
      const result = (await res.json()) as { isSuccess: boolean };
      expect(result.isSuccess).toBe(true);

      // Without the fix, context.effectiveFeatures is undefined and this
      // stays empty forever — waitFor times out on the missing entry.
      await waitFor(() => {
        expect(featuresSeenByJob.length).toBeGreaterThan(0);
        expect(featuresSeenByJob[0]?.has("some-feature")).toBe(true);
      });
    } finally {
      await entry.stop();
    }
  });
});
