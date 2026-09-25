// drainEventConsumers — pass-budgeted alternative to
// `while ((await eventDispatcher.runOnce())?.processed ?? 0) > 0) {}`, which
// under-drains a backlog bigger than one dispatcher batch and gives no
// diagnostics when a consumer is stuck.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { insertOne } from "../../db";
import { defineFeature } from "../../engine";
import { eventsTable } from "../../event-store";
import { drainEventConsumers } from "../drain-event-consumers";
import { resetEventStore } from "../table-helpers";
import { setupTestStack, type TestStack } from "../test-stack";
import { TestUsers } from "../test-users";

const admin = TestUsers.admin;
const TRACKER_QN = "drain-test:projection:tracker";
const POISON_QN = "drain-test:projection:poison";

// Distinct from POISON_TARGET_NAME (test 3's own poison consumer) so the two
// scenarios can't accidentally cross-trigger each other's throw branch.
const CASCADE_TRIGGER_NAME = "cascade-trigger";
const CASCADE_POISON_NAME = "cascade-poison-must-not-be-processed";
const POISON_TARGET_NAME = "always-poison";

let observed: string[] = [];

const drainTestFeature = defineFeature("drain-test", (r) => {
  r.multiStreamProjection({
    name: "tracker",
    apply: {
      "drain-test.tick": async (event, tx) => {
        const name = (event.payload as { name: string }).name;
        if (name === CASCADE_POISON_NAME) {
          throw new Error(`tracker must not process the post-snapshot cascade: ${name}`);
        }
        observed.push(name);
        // Simulates a consumer whose own handler writes a follow-up event —
        // drainEventConsumers snapshots the target once, so this write must
        // never be waited on.
        if (name === CASCADE_TRIGGER_NAME) {
          await insertOne(tx, eventsTable, {
            aggregateId: crypto.randomUUID(),
            aggregateType: "drain-test-source",
            tenantId: admin.tenantId,
            version: 1,
            type: "drain-test.tick",
            eventVersion: 1,
            payload: { name: CASCADE_POISON_NAME },
            metadata: { userId: admin.id },
            createdBy: admin.id,
          });
        }
      },
    },
  });
  r.multiStreamProjection({
    name: "poison",
    apply: {
      "drain-test.tick": async (event) => {
        const name = (event.payload as { name: string }).name;
        if (name === POISON_TARGET_NAME) {
          throw new Error(`boom: ${name}`);
        }
      },
    },
  });
});

async function appendTick(name: string): Promise<void> {
  await insertOne(stack.db, eventsTable, {
    aggregateId: crypto.randomUUID(),
    aggregateType: "drain-test-source",
    tenantId: admin.tenantId,
    version: 1,
    type: "drain-test.tick",
    eventVersion: 1,
    payload: { name },
    metadata: { userId: admin.id },
    createdBy: admin.id,
  });
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [drainTestFeature], systemHooks: [] });
});

afterEach(async () => {
  observed = [];
  await resetEventStore(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("drainEventConsumers", () => {
  test("backlog larger than the dispatcher batch size gets fully processed", async () => {
    const names = Array.from({ length: 220 }, (_, i) => `evt-${i}`);
    for (const name of names) await appendTick(name);

    await drainEventConsumers({ db: stack.db, eventDispatcher: stack.eventDispatcher }, [
      TRACKER_QN,
    ]);

    expect(observed.sort()).toEqual([...names].sort());
  });

  test("an event written after the HWM snapshot does not block", async () => {
    await appendTick(CASCADE_TRIGGER_NAME);

    await drainEventConsumers({ db: stack.db, eventDispatcher: stack.eventDispatcher }, [
      TRACKER_QN,
    ]);

    // The cascade event was written by the handler DURING the drain, after
    // the target snapshot — proven never processed (would throw otherwise).
    expect(observed).toEqual([CASCADE_TRIGGER_NAME]);
  });

  test("a throwing consumer exhausts the budget and the error contains lastError", async () => {
    await appendTick(POISON_TARGET_NAME);

    let caughtMessage: string | undefined;
    try {
      await drainEventConsumers(
        { db: stack.db, eventDispatcher: stack.eventDispatcher },
        [POISON_QN],
        { maxPasses: 2 },
      );
    } catch (e) {
      caughtMessage = e instanceof Error ? e.message : String(e);
    }

    expect(caughtMessage).toBeDefined();
    expect(caughtMessage).toContain(POISON_QN);
    expect(caughtMessage).toContain(`lastError=boom: ${POISON_TARGET_NAME}`);
  });

  test("an unknown consumer name throws", async () => {
    let caughtMessage: string | undefined;
    try {
      await drainEventConsumers({ db: stack.db, eventDispatcher: stack.eventDispatcher }, [
        "drain-test:projection:does-not-exist",
      ]);
    } catch (e) {
      caughtMessage = e instanceof Error ? e.message : String(e);
    }

    expect(caughtMessage).toContain(
      'consumer "drain-test:projection:does-not-exist" not registered or per-instance',
    );
  });

  test("missing eventDispatcher raises a clear error", async () => {
    let caughtMessage: string | undefined;
    try {
      await drainEventConsumers({ db: stack.db, eventDispatcher: undefined }, [TRACKER_QN]);
    } catch (e) {
      caughtMessage = e instanceof Error ? e.message : String(e);
    }

    expect(caughtMessage).toContain("eventDispatcher is undefined");
  });
});
