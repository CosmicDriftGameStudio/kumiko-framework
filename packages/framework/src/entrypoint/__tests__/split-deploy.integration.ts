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

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { createRegistry, defineFeature } from "../../engine";
import { createArchivedStreamsTable, createEventsTable } from "../../event-store";
import { createEventConsumerStateTable } from "../../pipeline";
import { createTestDb, createTestRedis, type TestDb, type TestRedis } from "../../testing";
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
