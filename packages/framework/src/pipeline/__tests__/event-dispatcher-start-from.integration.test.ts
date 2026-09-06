// EventConsumer.startFrom — opt-in cursor seed on FIRST registration
// (fw#2482/1). Mounting a NEW consumer into an app whose event log is
// already populated must not replay history and fire every side-effect
// step retroactively.
//
// setupTestStack's own dispatcher pre-registers every consumer eagerly at
// stack construction time (test-stack.ts: "Pre-register consumer state
// rows..."), before any test body can seed historical events — so it can't
// reproduce "mount into an already-running app" the way this fix needs.
// This test instead builds its own EventDispatcher via createEventDispatcher()
// against a plain createTestDb(), and only calls ensureRegistered() AFTER
// historical events already exist — the same order a real deploy of a new
// event-triggered workflow hits in production.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbTx } from "../../db/connection";
import { insertOne } from "../../db/query";
import type { AppContext } from "../../engine/types";
import { eventsTable } from "../../event-store";
import { createTestDb, type TestDb, TestUsers } from "../../stack";
import { createEventConsumerStateTable } from "../event-consumer-state";
import { createEventDispatcher, type EventConsumer, getConsumerState } from "../event-dispatcher";
import { fetchPendingEvents } from "../event-dispatcher-delivery";

const admin = TestUsers.admin;
let testDb: TestDb;
let historicalEventCount = 0;

function stubContext(): AppContext {
  return {
    db: {} as unknown as AppContext["db"],
    redis: {} as unknown as AppContext["redis"],
    registry: {} as unknown as AppContext["registry"],
  } as AppContext;
}

async function appendHistoricalEvent(type: string): Promise<void> {
  await insertOne(testDb.db, eventsTable, {
    aggregateId: crypto.randomUUID(),
    aggregateType: "start-from-test-source",
    tenantId: admin.tenantId,
    version: 1,
    type,
    eventVersion: 1,
    payload: {},
    metadata: { userId: admin.id },
    createdBy: admin.id,
  });
  historicalEventCount += 1;
}

beforeAll(async () => {
  // createTestDb() already materializes kumiko_events (see stack/db.ts).
  testDb = await createTestDb();
  await createEventConsumerStateTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("EventConsumer.startFrom", () => {
  test("'now' seeds the cursor at MAX(events.id) on first registration and skips the historical log", async () => {
    await appendHistoricalEvent("start-from-test.one");
    await appendHistoricalEvent("start-from-test.two");
    await appendHistoricalEvent("start-from-test.three");
    const headAtMount = BigInt(historicalEventCount);

    const captured: string[] = [];
    const consumer: EventConsumer = {
      name: "test:consumer:mounted-now",
      startFrom: "now",
      handler: async (event) => {
        captured.push(event.type);
      },
    };

    // Mirrors mounting a new event-triggered workflow into a production app
    // that already has a populated event log: the dispatcher (and its
    // consumer) is only constructed AFTER the historical events above exist.
    const dispatcher = createEventDispatcher({
      db: testDb.db,
      consumers: [consumer],
      context: stubContext(),
    });
    await dispatcher.ensureRegistered();

    const state = await getConsumerState(testDb.db, consumer.name);
    expect(state?.lastProcessedEventId).toBe(headAtMount);
    expect(state?.status).toBe("idle");

    const result = await dispatcher.runOnce();
    expect(result.byConsumer[consumer.name]).toEqual({ processed: 0, failed: 0 });
    expect(captured).toHaveLength(0);

    // Not just "not delivered" — proves the id > cursor contract directly:
    // no historical row is even fetched on the first pass.
    await testDb.db.begin(async (tx: DbTx) => {
      const pending = await fetchPendingEvents(tx, headAtMount, 100);
      expect(pending).toHaveLength(0);
    });
  });

  test("without startFrom (default 'beginning') a freshly-registered consumer replays the full historical log", async () => {
    await appendHistoricalEvent("start-from-test.four");
    await appendHistoricalEvent("start-from-test.five");
    const expectedReplayCount = historicalEventCount;

    const captured: string[] = [];
    const consumer: EventConsumer = {
      name: "test:consumer:mounted-beginning",
      handler: async (event) => {
        captured.push(event.type);
      },
    };

    const dispatcher = createEventDispatcher({
      db: testDb.db,
      consumers: [consumer],
      context: stubContext(),
    });
    await dispatcher.ensureRegistered();

    const stateBefore = await getConsumerState(testDb.db, consumer.name);
    expect(stateBefore?.lastProcessedEventId).toBe(0n);

    const result = await dispatcher.runOnce();
    expect(result.byConsumer[consumer.name]).toEqual({ processed: expectedReplayCount, failed: 0 });
    expect(captured).toEqual([
      "start-from-test.one",
      "start-from-test.two",
      "start-from-test.three",
      "start-from-test.four",
      "start-from-test.five",
    ]);
  });

  test("re-registering an already-registered consumer never clobbers an advanced cursor", async () => {
    const consumer: EventConsumer = {
      name: "test:consumer:advanced-then-remounted",
      startFrom: "now",
      handler: async () => {},
    };

    const dispatcher = createEventDispatcher({
      db: testDb.db,
      consumers: [consumer],
      context: stubContext(),
    });
    await dispatcher.ensureRegistered();
    const seeded = await getConsumerState(testDb.db, consumer.name);
    expect(seeded?.lastProcessedEventId).toBe(BigInt(historicalEventCount));

    await appendHistoricalEvent("start-from-test.six");
    await dispatcher.runOnce();
    const advanced = await getConsumerState(testDb.db, consumer.name);
    expect(advanced?.lastProcessedEventId).toBe(BigInt(historicalEventCount));

    // A new historical event exists again, not yet consumed by this consumer.
    await appendHistoricalEvent("start-from-test.seven");

    // A second dispatcher instance for the SAME consumer name simulates a
    // process restart re-running the boot-time pre-registration — the row
    // already exists, so ON CONFLICT DO NOTHING must leave its advanced
    // cursor untouched, not reseed it at the new (higher) MAX(events.id).
    const redeployedDispatcher = createEventDispatcher({
      db: testDb.db,
      consumers: [consumer],
      context: stubContext(),
    });
    await redeployedDispatcher.ensureRegistered();

    const afterRedeploy = await getConsumerState(testDb.db, consumer.name);
    expect(afterRedeploy?.lastProcessedEventId).toBe(advanced?.lastProcessedEventId);
  });
});
