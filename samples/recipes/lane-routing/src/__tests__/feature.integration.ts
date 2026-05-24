// Lane-Routing Sample — End-to-End Proof
//
// What we're proving (via createAllInOneEntrypoint + BullMQ + Hono — no
// framework-internal shortcuts):
//   1. A write lands on the HTTP surface.
//   2. The command-dispatcher fires `jobRunner.handleEvent` as an
//      afterCommit-hook (welle-2.5-gap fix, auto-wired by the entrypoint).
//   3. Both `runIn: "worker"` jobs fan out onto the `kumiko-jobs-worker`
//      queue and execute — the worker-side BullMQ worker picks them up,
//      the api-side one does not (even in all-in-one, the lane-scoped
//      dispatch() routes the job to the right queue).
//
// If the feature were wired with `runLocalJobs: true`-style api-lane
// jobs, the scaling.md pick-guide would apply — this sample stays
// worker-only because that's the prod default.

import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createAllInOneEntrypoint } from "@cosmicdrift/kumiko-framework/entrypoint";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import { createEventConsumerStateTable } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createLaneRoutingFeature, renderedReceipts, sentConfirmations } from "../feature";

const JWT = "lane-routing-sample-secret-minimum-32-chars!";
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

afterEach(() => {
  renderedReceipts.length = 0;
  sentConfirmations.length = 0;
});

describe("lane-routing sample", () => {
  test("order.create fans out to render-receipt + send-confirmation on the worker lane", async () => {
    const registry = createRegistry([createLaneRoutingFeature()]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const entry = createAllInOneEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
      queueNamePrefix: `lane-routing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
          type: "orders:write:order:create",
          payload: { customerName: "Acme GmbH", amount: 299 },
        }),
      });
      const result = (await res.json()) as { isSuccess: boolean };
      expect(result.isSuccess).toBe(true);

      // Both jobs are declared runIn:"worker" — they enqueue into
      // kumiko-jobs-worker-*, and the all-in-one worker runner consumes
      // them. Without welle-2.6 the enqueue would drop silently (welle-2.5
      // gap) or the routing would hit the wrong queue.
      await waitFor(() => {
        expect(renderedReceipts).toHaveLength(1);
        expect(sentConfirmations).toHaveLength(1);
        expect(renderedReceipts[0]?.customerName).toBe("Acme GmbH");
        expect(sentConfirmations[0]?.amount).toBe(299);
      });
    } finally {
      await entry.stop();
    }
  });
});
