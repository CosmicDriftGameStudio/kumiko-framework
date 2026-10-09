// A failed Redis publish in the shared SSE-broadcast consumer must fail the handler, so the
// dispatcher keeps the cursor and redelivers instead of silently dropping the fanout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRedisSseBroker } from "../../api/redis-sse-broker.js";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { createTenantDb } from "../../db/tenant-db.js";
import { defineFeature } from "../../engine/index.js";
import {
  createEventDispatcher,
  createSseBroadcastEventConsumer,
  getConsumerState,
  SSE_BROADCAST_CONSUMER_NAME,
} from "../../pipeline/index.js";
import {
  createTestRedis,
  setupTestStack,
  type TestRedis,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { sharedWidgetEntity, sharedWidgetTable } from "../../testing/index.js";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});
const feature = defineFeature("ssepublishfailure", (r) => {
  r.entity("widget", sharedWidgetEntity);
});

let stack: TestStack;
let testRedis: TestRedis;

beforeAll(async () => {
  testRedis = await createTestRedis();
  stack = await setupTestStack({ features: [feature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
});

afterAll(async () => {
  await testRedis.cleanup();
});

describe("sse-broadcast consumer with a failing Redis publish", () => {
  test("keeps the cursor behind the event so it is redelivered", async () => {
    const broker = createRedisSseBroker({ redisUrl: testRedis.redisUrl });
    const dispatcher = createEventDispatcher({
      db: stack.db,
      consumers: [createSseBroadcastEventConsumer(broker)],
      context: { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
      batchSize: 200,
      pollIntervalMs: 5000,
    });
    await dispatcher.ensureRegistered();

    await broker.close();
    const admin = TestUsers.admin;
    await executor.create({ name: "lost-push" }, admin, createTenantDb(stack.db, admin.tenantId));
    await dispatcher.runOnce();

    const state = await getConsumerState(stack.db, SSE_BROADCAST_CONSUMER_NAME);
    expect(state?.lastProcessedEventId).toBe(0n);
    expect(state?.lastError).not.toBeNull();
  });
});
