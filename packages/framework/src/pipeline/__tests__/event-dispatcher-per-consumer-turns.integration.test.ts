// A consumer stuck in a slow handler (Meili index+waitTask, for example) must
// not hold back delivery to the other consumers.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
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
import { sharedWidgetEntity, sharedWidgetTable, waitFor } from "../../testing";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

const feature = defineFeature("perconsumerturns", (r) => {
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

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

function buildDispatcher(consumers: readonly EventConsumer[]): EventDispatcher {
  return createEventDispatcher({
    db: stack.db,
    consumers,
    context: { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
    batchSize: 200,
    pollIntervalMs: 30,
  });
}

describe("event-dispatcher — per-consumer turns", () => {
  test("a blocked consumer does not delay another consumer's delivery", async () => {
    const blockingName = "perconsumerturns:blocking";
    const fastName = "perconsumerturns:fast";

    let aEntered = false;
    let releaseA: (() => void) | undefined;
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const fastSeen: string[] = [];

    // Order matters: A first. The old serial doPass() iterated consumers in
    // array order, so with the blocking consumer first, a regression back
    // to that code blocks the fast one too — this test must be red on it.
    const blockingConsumer: EventConsumer = {
      name: blockingName,
      handler: async () => {
        aEntered = true;
        await aGate;
      },
    };
    const fastConsumer: EventConsumer = {
      name: fastName,
      handler: async (event) => {
        fastSeen.push(String(event.payload["name"]));
      },
    };

    const dispatcher = buildDispatcher([blockingConsumer, fastConsumer]);
    await dispatcher.start();
    try {
      await appendWidget("one");

      await waitFor(() => aEntered === true, { delays: [20, 50, 100, 250] });

      // The fast consumer must advance while the blocking one is still stuck
      // inside its handler — proves the two no longer share a pass barrier.
      await waitFor(
        async () => {
          const fastState = await getConsumerState(stack.db, fastName);
          return fastState?.lastProcessedEventId === 1n;
        },
        { delays: [20, 50, 100, 250, 500] },
      );
      expect(fastSeen).toEqual(["one"]);

      const blockingStateWhileStuck = await getConsumerState(stack.db, blockingName);
      expect(blockingStateWhileStuck?.lastProcessedEventId).toBe(0n);

      releaseA?.();

      await waitFor(
        async () => {
          const blockingState = await getConsumerState(stack.db, blockingName);
          return blockingState?.lastProcessedEventId === 1n;
        },
        { delays: [20, 50, 100, 250, 500] },
      );
    } finally {
      // Release before stop() unconditionally — stop() drains in-flight
      // turns, which would hang forever if the blocking handler never
      // settles (e.g. the assertions above threw before releaseA() ran).
      releaseA?.();
      await dispatcher.stop();
    }
  });
});
