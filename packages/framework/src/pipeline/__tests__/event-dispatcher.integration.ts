// Async event-dispatcher — the AsyncDaemon-pendant for post-commit consumers.
//
// What this proves:
//   - A registered r.multiStreamProjection consumer gets called, in events.id
//     order, for every event after the consumer's cursor.
//   - The cursor advances: a second runOnce() with no new events is a no-op.
//   - A handler that throws pauses ONLY that consumer; other consumers keep
//     running independently.
//   - maxAttempts dead-letter: repeated throws eventually mark the consumer
//     status="dead", preserving lastError.
//
// Uses setupTestStack's registry-driven wiring so we exercise the same path
// production would take once ops wires CreateApp. No createEventDispatcher
// calls in the test — only the registry round-trip.

import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  integer as drizzleInteger,
  table as drizzlePgTable,
  uuid as drizzleUuid,
} from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature, type FeatureDefinition } from "../../engine";
import type { StoredEvent } from "../../event-store";
import { eventConsumerStateTable, getAllConsumerProgress, getConsumerState } from "../../pipeline";
import {
  createEntityTable,
  pushTables,
  resetEventStore,
  setupTestStack,
  sharedWidgetEntity,
  sharedWidgetTable,
  type TestStack,
  TestUsers,
} from "../../testing";

// --- Test fixtures ---

// A tiny state table a subscriber mutates so we can observe "the handler was
// called with this event" without relying on in-memory arrays — the state row
// survives even if the test framework resets process state.
const subscriberLogTable = drizzlePgTable("read_dispatcher_subscriber_log", {
  id: drizzleUuid("id").primaryKey().defaultRandom(),
  eventId: drizzleInteger("event_id").notNull(),
  eventType: drizzleUuid("event_type"), // unused, kept to avoid another drizzle type import
});

// Per-test capture. The subscriber handlers push here; beforeEach resets.
type CapturedCall = { event: StoredEvent };
let captureA: CapturedCall[] = [];
let captureB: CapturedCall[] = [];
let throwOnEventId: string | null = null;

const testFeature: FeatureDefinition = defineFeature("dispatchertest", (r) => {
  r.entity("widget", sharedWidgetEntity);

  // MSP A: happy-path observer.
  r.multiStreamProjection({
    name: "observer-a",
    apply: {
      "widget.created": async (event) => {
        captureA.push({ event });
      },
    },
  });

  // MSP B: independent cursor + fault-injection hook. When `throwOnEventId`
  // matches, throws → pauses B while A continues.
  r.multiStreamProjection({
    name: "observer-b",
    apply: {
      "widget.created": async (event) => {
        if (throwOnEventId && event.id === throwOnEventId) {
          throw new Error(`injected-failure-on-event-${event.id}`);
        }
        captureB.push({ event });
      },
    },
  });
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

const qnA = "dispatchertest:projection:observer-a";
const qnB = "dispatchertest:projection:observer-b";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [testFeature],
    // Keep hooks off — we're testing the dispatcher, not the legacy postSave
    // hook chain. SSE / search are irrelevant to cursor behaviour.
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, sharedWidgetEntity, "widget");
  await pushTables(stack.db.db, { subscriberLog: subscriberLogTable });
  tdb = createTenantDb(stack.db.db, admin.tenantId);
});

afterEach(async () => {
  captureA = [];
  captureB = [];
  throwOnEventId = null;
  // Wipe events + cursor state so each test starts at event.id=0 cleanly.
  await resetEventStore(stack, ["read_widgets", "read_dispatcher_subscriber_log"]);
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

// --- Tests ---

describe("event-dispatcher — happy path", () => {
  test("registered subscribers receive every event in id order", async () => {
    await appendWidget("one");
    await appendWidget("two");
    await appendWidget("three");

    // Before runOnce: nothing delivered, but state row pre-registered with
    // cursor=0 (Sprint-E strict pre-reg — see EventDispatcher.start /
    // ensureRegistered). Lazy-bootstrap in acquireConsumerState was removed
    // because it opened a race against prune; the row is now guaranteed to
    // exist from dispatcher boot.
    expect(captureA).toHaveLength(0);
    const preState = await getConsumerState(stack.db.db, qnA);
    expect(preState?.lastProcessedEventId).toBe(0n);
    expect(preState?.status).toBe("idle");

    const result = await stack.eventDispatcher?.runOnce();
    expect(result?.byConsumer[qnA]).toEqual({ processed: 3, failed: 0 });
    expect(result?.byConsumer[qnB]).toEqual({ processed: 3, failed: 0 });

    // Both consumers observed all three creates.
    expect(captureA.map((c) => c.event.type)).toEqual([
      "widget.created",
      "widget.created",
      "widget.created",
    ]);
    expect(captureB.map((c) => c.event.type)).toEqual([
      "widget.created",
      "widget.created",
      "widget.created",
    ]);

    // Cursor advanced independently for each consumer.
    const stateA = await getConsumerState(stack.db.db, qnA);
    const stateB = await getConsumerState(stack.db.db, qnB);
    expect(stateA?.status).toBe("idle");
    expect(stateA?.lastProcessedEventId).toBeGreaterThan(0n);
    expect(stateB?.status).toBe("idle");
    expect(stateB?.lastProcessedEventId).toEqual(stateA?.lastProcessedEventId);
  });

  test("second runOnce with no new events is a no-op", async () => {
    await appendWidget("one");
    await stack.eventDispatcher?.runOnce();
    expect(captureA).toHaveLength(1);

    const second = await stack.eventDispatcher?.runOnce();
    expect(second?.byConsumer[qnA]).toEqual({ processed: 0, failed: 0 });
    // Still only one — consumer correctly saw "nothing new past my cursor".
    expect(captureA).toHaveLength(1);
  });

  test("cursor advances only past successfully-consumed events", async () => {
    await appendWidget("one");
    const first = await stack.eventDispatcher?.runOnce();
    const cursorAfterFirst = first?.byConsumer[qnA]?.processed;
    expect(cursorAfterFirst).toBe(1);

    await appendWidget("two");
    await appendWidget("three");
    const second = await stack.eventDispatcher?.runOnce();
    // Exactly the two new ones — no replay of "one", no skip.
    expect(second?.byConsumer[qnA]).toEqual({ processed: 2, failed: 0 });
  });
});

describe("event-dispatcher — isolation between consumers", () => {
  test("a throwing subscriber halts ITS cursor only; others keep advancing", async () => {
    await appendWidget("safe-1");
    await appendWidget("poison");
    await appendWidget("safe-3");

    // Inject the throw on the SECOND event for observer-b.
    // observer-a should see all three; observer-b should only see the first.
    // Without isolation, a cross-consumer error would break both — we prove
    // the per-consumer transaction boundary holds.
    // Pre-registered state rows exist from boot (strict Sprint-E mode) — at
    // this point they're at cursor=0 / status=idle for both observers.
    const state = await stack.db.db
      .select()
      .from(eventConsumerStateTable)
      .where(sql`${eventConsumerStateTable.name} = ${qnA}`);
    expect(state).toHaveLength(1);
    expect(state[0]?.lastProcessedEventId).toBe(0n);

    // event.id is bigint, coerce to string for the check inside the handler
    throwOnEventId = "2";

    await stack.eventDispatcher?.runOnce();

    // observer-a saw everything.
    expect(captureA).toHaveLength(3);
    // observer-b saw only the first event; the throw on event 2 stopped it.
    expect(captureB).toHaveLength(1);
    expect(captureB[0]?.event.payload["name"]).toBe("safe-1");

    const stateA = await getConsumerState(stack.db.db, qnA);
    const stateB = await getConsumerState(stack.db.db, qnB);

    expect(stateA?.status).toBe("idle");
    expect(stateA?.lastProcessedEventId).toBe(3n);

    // B is still idle (not yet dead — only 1 attempt), cursor stopped at 1
    // (the last successfully-processed event).
    expect(stateB?.status).toBe("idle");
    expect(stateB?.lastProcessedEventId).toBe(1n);
    expect(stateB?.attempts).toBe(1);
    expect(stateB?.lastError).toMatch(/injected-failure-on-event-2/);
  });

  test("repeated throws eventually mark the consumer dead", async () => {
    await appendWidget("poison-start");
    throwOnEventId = "1";

    // Default maxAttempts = 10. Drive runOnce that many times to exhaust.
    for (let i = 0; i < 10; i++) {
      await stack.eventDispatcher?.runOnce();
    }

    const stateB = await getConsumerState(stack.db.db, qnB);
    expect(stateB?.status).toBe("dead");
    expect(stateB?.attempts).toBe(10);
    expect(stateB?.lastError).toMatch(/injected-failure-on-event-1/);

    // observer-a is unaffected.
    expect(captureA).toHaveLength(1);
    const stateA = await getConsumerState(stack.db.db, qnA);
    expect(stateA?.status).toBe("idle");
    expect(stateA?.lastProcessedEventId).toBe(1n);

    // A dead consumer skips further passes even if new events arrive.
    await appendWidget("after-death");
    await stack.eventDispatcher?.runOnce();
    // observer-a picked up the new event.
    expect(captureA).toHaveLength(2);
    // observer-b stayed dead — no further attempts.
    const stateBAfter = await getConsumerState(stack.db.db, qnB);
    expect(stateBAfter?.status).toBe("dead");
    expect(stateBAfter?.attempts).toBe(10);
  });
});

describe("getAllConsumerProgress — Ops-View für consumer lag", () => {
  test("lag = highWaterMark - cursor pro consumer, caught-up = 0n", async () => {
    // Caught-up state nach normal flow.
    await appendWidget("one");
    await appendWidget("two");
    await stack.eventDispatcher?.runOnce();

    const caughtUp = await getAllConsumerProgress(stack.db.db, [qnA, qnB]);
    const a = caughtUp.find((c) => c.name === qnA);
    const b = caughtUp.find((c) => c.name === qnB);
    expect(a?.highWaterMark).toBe(2n);
    expect(a?.lag).toBe(0n);
    expect(b?.lag).toBe(0n);

    // Three more events without runOnce → consumers fall behind.
    await appendWidget("three");
    await appendWidget("four");
    await appendWidget("five");

    const lagged = await getAllConsumerProgress(stack.db.db, [qnA, qnB]);
    const aLag = lagged.find((c) => c.name === qnA);
    expect(aLag?.highWaterMark).toBe(5n);
    expect(aLag?.lastProcessedEventId).toBe(2n);
    expect(aLag?.lag).toBe(3n);
  });
});
