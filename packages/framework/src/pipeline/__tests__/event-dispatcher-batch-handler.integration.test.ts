// batchHandler wired into a real dispatcher pass: a successful
// batch is delivered in one call (handler never runs, cursor lands at the
// last event) and a batch+handler failure still dead-letters through the
// normal errorPolicy machinery, delivering the poisoned event via handler
// exactly once before it does.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sharedWidgetEntity, sharedWidgetTable } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { createTenantDb, type TenantDb } from "../../db/tenant-db.ts";
import { defineFeature } from "../../engine/index.ts";
import type { StoredEvent } from "../../event-store/index.ts";
import { type EventDispatcher, getConsumerState } from "../../pipeline/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import type { EventConsumer } from "../event-dispatcher.ts";
import { createEventDispatcher } from "../event-dispatcher.ts";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

const feature = defineFeature("batchhandlerintegration", (r) => {
  r.entity({ name: "widget", ...sharedWidgetEntity });
});

const admin = TestUsers.admin;
const otherTenantUser = TestUsers.otherTenant;
let stack: TestStack;
let tdb: TenantDb;
let otherTenantDb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb({ db: stack.db, tenantId: admin.tenantId });
  otherTenantDb = createTenantDb({ db: stack.db, tenantId: otherTenantUser.tenantId });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_widgets"]);
});

async function appendWidget(name: string): Promise<string> {
  const created = await executor.create({ name }, admin, tdb);
  if (!created.isSuccess) throw new Error("create failed");
  return String(created.data.id);
}

async function appendOtherTenantWidget(name: string): Promise<string> {
  const created = await executor.create({ name }, otherTenantUser, otherTenantDb);
  if (!created.isSuccess) throw new Error("create failed");
  return String(created.data.id);
}

function buildDispatcher(consumers: readonly EventConsumer[], batchSize = 200): EventDispatcher {
  return createEventDispatcher({
    db: stack.db,
    consumers,
    context: { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
    batchSize,
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

  test("a held event does not stop the turn and comes back first on the next turn until released", async () => {
    const consumerName = "batchhandlerintegration:hold";
    const turns: string[][] = [];
    let heldAggregateId: string | undefined;
    let holding = true;

    const consumer: EventConsumer = {
      name: consumerName,
      batchHandler: async (events, _ctx, turn) => {
        turns.push(events.map((event) => event.aggregateId));
        const held = events.filter((event) => event.aggregateId === heldAggregateId);
        if (holding)
          turn.holdForRetry(
            held.map((event) => event.id),
            "partition unavailable",
          );
      },
      handler: async () => {
        throw new Error("per-event fallback must not run while the batch succeeds");
      },
    };

    const dispatcher = buildDispatcher([consumer]);
    await dispatcher.ensureRegistered();

    heldAggregateId = await appendWidget("held");
    const passingId = await appendWidget("passing");

    const firstPass = await dispatcher.runOnce();
    expect(firstPass.byConsumer[consumerName]).toEqual({ processed: 1, failed: 1 });
    const heldState = await getConsumerState(stack.db, consumerName);
    expect(heldState?.status).toBe("idle");
    expect(heldState?.lastError).toBe("partition unavailable");

    const laterId = await appendWidget("later");
    await dispatcher.runOnce();
    holding = false;
    await dispatcher.runOnce();
    await dispatcher.runOnce();

    expect(turns).toEqual([
      [heldAggregateId, passingId],
      [heldAggregateId, laterId],
      [heldAggregateId],
    ]);
    const releasedState = await getConsumerState(stack.db, consumerName);
    expect(releasedState?.lastError).toBeNull();
    expect(releasedState?.attempts).toBe(0);
  });

  test("held events fill at most half a batch; newer events of other tenants still go through, the holding tenant's wait in order", async () => {
    const consumerName = "batchhandlerintegration:hold-cap";
    const turns: string[][] = [];
    let holding = true;

    const consumer: EventConsumer = {
      name: consumerName,
      batchHandler: async (events, _ctx, turn) => {
        turns.push(events.map((event) => event.aggregateId));
        const held = events.filter((event) => event.tenantId === admin.tenantId);
        if (holding)
          turn.holdForRetry(
            held.map((event) => event.id),
            "tenant index unavailable",
          );
      },
      handler: async () => {
        throw new Error("per-event fallback must not run while the batch succeeds");
      },
    };

    const dispatcher = buildDispatcher([consumer], 4);
    await dispatcher.ensureRegistered();

    const held1 = await appendWidget("held one");
    const held2 = await appendWidget("held two");
    const held3 = await appendWidget("held three");
    const other1 = await appendOtherTenantWidget("other one");
    await dispatcher.runOnce();

    const held4 = await appendWidget("held four");
    const other2 = await appendOtherTenantWidget("other two");
    await dispatcher.runOnce();

    holding = false;
    await dispatcher.runOnce();
    await dispatcher.runOnce();
    await dispatcher.runOnce();

    expect(turns.slice(0, 2)).toEqual([
      [held1, held2, held3, other1],
      [held1, held2, other2],
    ]);
    const heldTenantAfterRelease = turns.slice(2).flat();
    expect(heldTenantAfterRelease).toEqual([held1, held2, held3, held4]);
    const state = await getConsumerState(stack.db, consumerName);
    expect(state?.lastError).toBeNull();
  });
});
