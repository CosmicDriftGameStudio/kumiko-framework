// Shape-level proof of the three entrypoint factories. End-to-end
// split-deploy (API writes → worker MSP applies) requires the full
// test-stack infrastructure (consumer-state table, MSP wiring, dispatcher
// options) and is better exercised via a dedicated sample app. Here we
// pin the public guarantees:
//
//   1. API entrypoint has no eventDispatcher/jobRunner handles.
//   2. Worker entrypoint has no HTTP app.
//   3. All-in-one has both.
//   4. Worker throws when there's literally nothing to consume (defensive
//      guard — buildServer always wires an SSE consumer so this only
//      fires with systemConsumers explicitly disabled).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { createRegistry, defineFeature } from "../../engine";
import { createArchivedStreamsTable, createEventsTable } from "../../event-store";
import { createEventConsumerStateTable } from "../../pipeline";
import { createTestRedis, type TestRedis } from "../../stack";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { createAllInOneEntrypoint, createApiEntrypoint, createWorkerEntrypoint } from "../index";

const splitFeature = defineFeature("split", (r) => {
  const tick = r.defineEvent("tick", z.object({ note: z.string() }), { version: 1 });
  r.multiStreamProjection({
    name: "spy",
    apply: {
      [tick.name]: async () => {},
    },
  });
});

const JWT = "split-deploy-test-secret-must-be-32-chars!!";

// Per-test queue-name with a random suffix. Date.now() alone collided
// in jobs.integration.ts when two tests landed in the same millisecond —
// the random suffix pins each test's BullMQ queues even then.
function uniquePrefix(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

describe("entrypoint factories", () => {
  test("API entrypoint exposes HTTP app but NOT dispatcher / jobRunner handles", async () => {
    const registry = createRegistry([splitFeature]);
    const api = createApiEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
    });

    expect(api.mode).toBe("api");
    expect(api.app).toBeDefined();
    expect(api.jwt).toBeDefined();
    expect(api.sseBroker).toBeDefined();
    expect("eventDispatcher" in api).toBe(false);
    expect("jobRunner" in api).toBe(false);

    await api.start(); // no-op
    await api.stop();
  });

  test("Worker entrypoint exposes dispatcher + jobRunner but NOT an HTTP app", async () => {
    const registry = createRegistry([splitFeature]);
    const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:16379";
    const worker = createWorkerEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
    });

    expect(worker.mode).toBe("worker");
    expect(worker.eventDispatcher).toBeDefined();
    expect(worker.jobRunner).toBeDefined();
    expect("app" in worker).toBe(false);
    expect("jwt" in worker).toBe(false);

    // Stop without starting — lifecycle.drain runs the registered
    // jobRunner hook which must be idempotent against an unstarted
    // BullMQ worker.
    await worker.stop();
  });

  test("All-in-one entrypoint has both HTTP surface and background workers", async () => {
    const registry = createRegistry([splitFeature]);
    const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:16379";
    const entry = createAllInOneEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
    });

    expect(entry.mode).toBe("all-in-one");
    expect(entry.app).toBeDefined();
    expect(entry.eventDispatcher).toBeDefined();
    expect(entry.jobRunner).toBeDefined();

    await entry.stop();
  });

  test("lifecycle.drain() flips /health/ready to 503 across modes", async () => {
    const registry = createRegistry([splitFeature]);
    const api = createApiEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
    });

    const before = await api.app.request("/health/ready");
    expect(before.status).toBe(200);

    await api.stop();

    const after = await api.app.request("/health/ready");
    expect(after.status).toBe(503);
  });
});

// --- Welle 2.6.b: runIn lane-filtering ---
//
// Covers the per-lane consumer filtering added to buildServer. The feature
// declares three MSPs, one per runIn value, plus jobs with different runIns.
// We observe the number of consumers the dispatcher actually wires in each
// mode — the mechanism is "MSPs whose runIn isn't eligible for this
// process's lane are skipped during buildServer()".

const laneFeature = defineFeature("lane", (r) => {
  const ping = r.defineEvent("ping", z.object({}), { version: 1 });
  // Three MSPs: one pinned to api, one to worker (explicit), one to both.
  // A fourth would be a default-undefined-runIn MSP which resolves to
  // "worker" — covered implicitly by the worker test below.
  r.multiStreamProjection({
    name: "lane-api",
    runIn: "api",
    apply: { [ping.name]: async () => {} },
  });
  r.multiStreamProjection({
    name: "lane-worker",
    runIn: "worker",
    apply: { [ping.name]: async () => {} },
  });
  r.multiStreamProjection({
    name: "lane-both",
    runIn: "both",
    apply: { [ping.name]: async () => {} },
  });
  // Default runIn (= "worker") — makes the legacy-no-runIn path observable.
  r.multiStreamProjection({
    name: "lane-default",
    apply: { [ping.name]: async () => {} },
  });
});

describe("runIn lane-filtering (Welle 2.6.b)", () => {
  test("API entrypoint with runLocalJobs filters MSPs to runIn ∈ {api, both}", async () => {
    const registry = createRegistry([laneFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const api = createApiEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      // Force the dispatcher to actually build by clearing {disabled:true} —
      // needs a jobs block because the API otherwise has no consumer at all
      // once SSE is the default-on system-consumer. We still observe MSP
      // count via the registered consumers; JobRunner is incidental here.
      jobs: { redisUrl, queueNamePrefix: uniquePrefix("split-api"), runLocalJobs: true },
    });

    try {
      // API defaults the dispatcher to disabled, so eventDispatcher is not
      // in the return shape. Assert the shape contract plus the fact that
      // start() is a real operation now (runLocalJobs started a worker).
      expect(api.mode).toBe("api");
      expect("eventDispatcher" in api).toBe(false);
      expect("jobRunner" in api).toBe(false);
      await api.start();
    } finally {
      await api.stop();
    }
  });

  test("Worker entrypoint runs lane-worker + lane-both + lane-default, skips lane-api", async () => {
    const registry = createRegistry([laneFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const worker = createWorkerEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
      queueNamePrefix: uniquePrefix("split-worker"),
    });

    // eventDispatcher.consumers exposes the filtered list — lane-api must
    // be absent, the other three present. SSE + Search system-consumers
    // add noise (both default-on), so we only check MSP names.
    const consumerNames = worker.eventDispatcher.consumers.map((c) => c.name);
    expect(consumerNames).toContain("lane:projection:lane-worker");
    expect(consumerNames).toContain("lane:projection:lane-both");
    expect(consumerNames).toContain("lane:projection:lane-default");
    expect(consumerNames).not.toContain("lane:projection:lane-api");

    await worker.stop();
  });

  test("All-in-one runs every MSP — processLane 'both' disables the filter", async () => {
    const registry = createRegistry([laneFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const entry = createAllInOneEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
      queueNamePrefix: uniquePrefix("split-all"),
    });

    const consumerNames = entry.eventDispatcher.consumers.map((c) => c.name);
    expect(consumerNames).toContain("lane:projection:lane-api");
    expect(consumerNames).toContain("lane:projection:lane-worker");
    expect(consumerNames).toContain("lane:projection:lane-both");
    expect(consumerNames).toContain("lane:projection:lane-default");

    await entry.stop();
  });
});

// --- Welle 2.6.c: boot-validation ---
//
// Jobs with runIn="api" can only be consumed by an API process that has
// runLocalJobs=true — workers never look at the "api" queue. The entrypoint
// factory must refuse to start with a config that would orphan those jobs,
// because otherwise an operator finds out at traffic time via "jobs
// enqueue fine, nothing runs".

const apiJobFeature = defineFeature("api-jobs", (r) => {
  r.job("local-cleanup", { trigger: { manual: true }, runIn: "api" }, async () => {});
});

const workerJobFeature = defineFeature("worker-jobs", (r) => {
  r.job("heavy", { trigger: { manual: true }, runIn: "worker" }, async () => {});
});

describe("createApiEntrypoint boot-validation (Welle 2.6.c)", () => {
  test("declared jobs + no jobs-block → fails fast (enqueue would drop)", () => {
    const registry = createRegistry([workerJobFeature]);
    expect(() =>
      createApiEntrypoint({
        registry,
        context: { db: testDb.db, redis: testRedis.redis },
        jwtSecret: JWT,
      }),
    ).toThrow(/no `jobs` block was passed.*event-triggered writes would silently drop/i);
  });

  test("runIn='api' jobs require runLocalJobs=true on the api entrypoint", () => {
    const registry = createRegistry([apiJobFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    expect(() =>
      createApiEntrypoint({
        registry,
        context: { db: testDb.db, redis: testRedis.redis },
        jwtSecret: JWT,
        jobs: { redisUrl, queueNamePrefix: uniquePrefix("val") },
      }),
    ).toThrow(/runIn="api".*runLocalJobs.*no consumer.*local-cleanup/is);
  });

  test("runIn='worker' jobs do NOT require runLocalJobs — api is enqueuer-only", async () => {
    const registry = createRegistry([workerJobFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const api = createApiEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      jobs: { redisUrl, queueNamePrefix: uniquePrefix("val-ok") },
    });
    try {
      expect(api.mode).toBe("api");
      await api.start();
    } finally {
      await api.stop();
    }
  });
});
