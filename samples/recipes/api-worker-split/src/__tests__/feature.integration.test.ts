// API/Worker-Split Sample — integration test
//
// Proves the split topology against real Postgres + Redis by running the
// two entrypoints in-process (same wiring the binaries use):
//
//   1. API-only: the write lands and read_orders has its row (entity rows
//      are written synchronously by the executor), but read_order_activity
//      stays EMPTY — `runSingleInstance:false` means the API applies no
//      multiStreamProjections. The 2026-06-11 sharp edge, live.
//   2. Worker joins: it consumes the worker-lane job, applies the
//      projection, and writes the fulfillment back through the WORKER's
//      dispatcher (dispatchSystemWrite → orders:write:fulfillment:create).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import {
  createApiEntrypoint,
  createWorkerEntrypoint,
} from "@cosmicdrift/kumiko-framework/entrypoint";
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
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { makeDispatchSystemWrite } from "@cosmicdrift/kumiko-server-runtime/extra-routes-deps";
import {
  createApiWorkerSplitFeature,
  fulfillmentEntity,
  orderActivityTable,
  orderEntity,
  setOrderFulfillWrite,
} from "../feature";

const JWT = "api-worker-split-sample-secret-minimum-32-chars!";
const adminUser = TestUsers.admin;

let testDb: TestDb;
let testRedis: TestRedis;

const orderTable = buildEntityTable("order", orderEntity);
const fulfillmentTable = buildEntityTable("fulfillment", fulfillmentEntity);

beforeAll(async () => {
  [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);
  await createEventsTable(testDb.db);
  await createArchivedStreamsTable(testDb.db);
  await createEventConsumerStateTable(testDb.db);
  await unsafeCreateEntityTable(testDb.db, orderEntity, "order");
  await unsafeCreateEntityTable(testDb.db, fulfillmentEntity, "fulfillment");
  await unsafePushTables(testDb.db, { orderActivity: orderActivityTable });
});

afterAll(async () => {
  await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
});

function redisUrl(): string {
  return `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
}

function uniquePrefix(): string {
  return `aws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function writeOrder(
  api: Awaited<ReturnType<typeof createApiEntrypoint>>,
  customerName: string,
  amount: number,
): Promise<boolean> {
  const token = await api.jwt.sign(adminUser);
  const res = await api.app.request("/api/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      type: "orders:write:order:create",
      payload: { customerName, amount },
    }),
  });
  const result = (await res.json()) as { isSuccess: boolean };
  return result.isSuccess;
}

describe("api-worker-split", () => {
  test("API-only: write lands, but the worker-applied read side stays empty", async () => {
    const prefix = uniquePrefix();
    const api = createApiEntrypoint({
      registry: createRegistry([createApiWorkerSplitFeature()]),
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      jobs: { redisUrl: redisUrl(), queueNamePrefix: prefix },
    });
    await api.start();
    try {
      expect(await writeOrder(api, "Acme GmbH", 499)).toBe(true);

      // Entity rows are written synchronously by the event-store executor —
      // present even in split mode.
      await waitFor(async () => {
        const orders = await selectMany<{ customer_name: string }>(testDb.db, orderTable, {});
        expect(orders).toHaveLength(1);
      });

      // The async read model never applies: no local dispatcher, no local
      // runner. Without a worker this table stays empty, silently.
      await Bun.sleep(500);
      const activity = await selectMany(testDb.db, orderActivityTable, {});
      const fulfillments = await selectMany(testDb.db, fulfillmentTable, {});
      expect(activity).toHaveLength(0);
      expect(fulfillments).toHaveLength(0);
    } finally {
      await api.stop();
    }
  });

  test("worker joins: consumes the job, applies the projection, writes the result back", async () => {
    const prefix = uniquePrefix();
    const api = createApiEntrypoint({
      registry: createRegistry([createApiWorkerSplitFeature()]),
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      jobs: { redisUrl: redisUrl(), queueNamePrefix: prefix },
    });
    const worker = createWorkerEntrypoint({
      registry: createRegistry([createApiWorkerSplitFeature()]),
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl: redisUrl(),
      queueNamePrefix: prefix,
    });
    setOrderFulfillWrite(makeDispatchSystemWrite(worker.dispatcher));

    await Promise.all([api.start(), worker.start()]);
    try {
      expect(await writeOrder(api, "Globex Ltd", 1299)).toBe(true);

      // Worker's dispatcher applied the projection the API skipped…
      await waitFor(async () => {
        const activity = await selectMany<{ orderKey: string }>(testDb.db, orderActivityTable, {});
        expect(activity.some((row) => row.orderKey === "Globex Ltd")).toBe(true);
      });

      // …and the job wrote the fulfillment back through the WORKER's
      // dispatcher (JobContext has no write/query).
      await waitFor(async () => {
        const fulfillments = await selectMany<{ orderKey: string; carrier: string }>(
          testDb.db,
          fulfillmentTable,
          {},
        );
        expect(fulfillments.some((row) => row.orderKey === "Globex Ltd")).toBe(true);
        expect(fulfillments[0]?.carrier).toBe("DHL");
      });
    } finally {
      await Promise.all([api.stop(), worker.stop()]);
    }
  });
});
