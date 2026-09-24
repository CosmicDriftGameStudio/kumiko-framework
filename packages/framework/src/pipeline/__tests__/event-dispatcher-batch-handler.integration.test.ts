// #3227 — batchHandler wired into a real dispatcher pass: a successful
// batch is delivered in one call (handler never runs, cursor lands at the
// last event) and a batch+handler failure still dead-letters through the
// normal errorPolicy machinery, delivering the poisoned event via handler
// exactly once before it does.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import type { StoredEvent } from "../../event-store";
import {
  createEventDispatcher,
  type EventConsumer,
  type EventDispatcher,
  getConsumerState,
} from "../../pipeline";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable } from "../../testing";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

const feature = defineFeature("batchhandlerintegration", (r) => {
  r.entity("widget", sharedWidgetEntity);
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterEach(async () => {
  await resetEventStore(stack, ["read_widgets"]);
});

async function appendWidget(name: string): Promise<string> {
  const created = await executor.create({ name }, admin, tdb);
  if (!created.isSuccess) throw new Error("create failed");
  return String(created.data.id);
}

function buildDispatcher(consumers: readonly EventConsumer[]): EventDispatcher {
  return createEventDispatcher({
    db: stack.db,
    consumers,
    context: { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
    batchSize: 200,
    // No timer/LISTEN involved — runOnce() below drives every pass
    // explicitly, so pollIntervalMs never fires a competing pass.
    pollIntervalMs: 60_000,
  });
}

describe("event-dispatcher — batchHandler", () => {
  test("a successful batch delivers all events in one call, handler stays unused, cursor lands on the last event", async () => {
    const consumerName = "batchhandlerintegration:success";
    const batchSizes: number[] = [];
    const batchIds: bigint[] = [];
    const handlerIds: string[] = [];

    const consumer: EventConsumer = {
      name: consumerName,
      batchHandler: async (events) => {
        batchSizes.push(events.length);
        for (const event of events) batchIds.push(BigInt(event.id));
      },
      handler: async (event) => {
        handlerIds.push(event.aggregateId);
      },
    };

    const dispatcher = buildDispatcher([consumer]);
    await dispatcher.ensureRegistered();

    await appendWidget("one");
    await appendWidget("two");
    await appendWidget("three");

    const result = await dispatcher.runOnce();

    expect(batchSizes).toEqual([3]);
    expect(handlerIds).toEqual([]);
    expect(result.byConsumer[consumerName]).toEqual({ processed: 3, failed: 0 });

    const state = await getConsumerState(stack.db, consumerName);
    expect(state?.status).toBe("idle");
    expect(state?.lastProcessedEventId).toBe(batchIds.at(-1));
  });

  test("batch throws, handler poisons the 2nd event: dead-letters at maxAttempts, first event delivered exactly once via handler", async () => {
    const consumerName = "batchhandlerintegration:poison";
    const handlerCalls: StoredEvent[] = [];
    let poisonAggregateId: string | undefined;

    const consumer: EventConsumer = {
      name: consumerName,
      errorPolicy: { maxAttempts: 2 },
      batchHandler: async () => {
        throw new Error("batch always fails in this test");
      },
      handler: async (event) => {
        handlerCalls.push(event);
        if (event.aggregateId === poisonAggregateId) {
          throw new Error("poisoned event");
        }
      },
    };

    const dispatcher = buildDispatcher([consumer]);
    await dispatcher.ensureRegistered();

    await appendWidget("first");
    poisonAggregateId = await appendWidget("second");

    const firstPass = await dispatcher.runOnce();
    expect(firstPass.byConsumer[consumerName]?.failed).toBeGreaterThan(0);

    const secondPass = await dispatcher.runOnce();
    expect(secondPass.byConsumer[consumerName]).toBeDefined();

    const state = await getConsumerState(stack.db, consumerName);
    expect(state?.status).toBe("dead");

    const firstEventDeliveries = handlerCalls.filter(
      (event) => event.aggregateId === handlerCalls[0]?.aggregateId,
    );
    expect(firstEventDeliveries).toHaveLength(1);
    expect(state?.lastProcessedEventId).toBe(BigInt(handlerCalls[0]?.id ?? "0"));
  });
});
