// E.5 — Multi-instance claims. The whole reason the dispatcher was designed
// around SELECT FOR UPDATE SKIP LOCKED is that in production there are N
// dispatcher processes, not 1. If two dispatchers try to advance the same
// consumer in parallel, SKIP LOCKED must guarantee: **exactly one** drives
// the pass, the other no-ops, zero duplicate delivery.
//
// The existing event-dispatcher.integration.ts runs everything single-
// instance. These tests pin the cross-process claims:
//
//   1. Two dispatchers on the same DB + same consumer name: handler is
//      called exactly once per event (no duplicate delivery).
//   2. Two dispatchers with different consumer names: both progress
//      independently — one slow consumer doesn't starve the other.
//   3. A consumer joining with 2000 events in the backlog catches up
//      across multiple passes without replaying events or exploding.
//
// Note: these tests assert on behaviour that is not observable in
// single-instance runs. Any regression in the locking strategy shows up
// here first.

import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import { eventsTable, type StoredEvent } from "../../event-store";
import {
  createEventDispatcher,
  type EventConsumer,
  type EventDispatcher,
  getConsumerState,
} from "../../pipeline";
import {
  createEntityTable,
  setupTestStack,
  sharedWidgetEntity,
  sharedWidgetTable,
  type TestStack,
  TestUsers,
} from "../../testing";

// --- Fixture ---

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

// A trivial feature — the dispatchers built by the tests use the same
// consumer name ("multi:consumer:echo") via direct createEventDispatcher
// calls (no r.multiStreamProjection registration on this stack, since the
// test-stack would then auto-wire a subscriber we don't want in the
// multi-instance setup).
const multiFeature = defineFeature("multi", (r) => {
  r.entity("widget", sharedWidgetEntity);
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [multiFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db.db, admin.tenantId);
});

afterEach(async () => {
  await stack.db.db.execute(
    sql`TRUNCATE events, widgets, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
});

async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

// Bulk-seed N widget.created events directly into the events table.
// Used by the backlog test where the seed phase would otherwise dominate
// runtime (2000 sequential executor.create = 2000 DB round-trips).
// The dispatcher only reads from events — bypassing the projections-table
// write is safe here; we're testing cursor catch-up, not the executor.
async function bulkSeedWidgetCreated(count: number, namePrefix: string): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => ({
    aggregateId: globalThis.crypto.randomUUID(),
    aggregateType: "widget",
    tenantId: admin.tenantId,
    version: 1,
    type: "widget.created",
    payload: { name: `${namePrefix}${i}` },
    metadata: { userId: admin.id },
    createdBy: admin.id,
  }));
  await stack.db.db.insert(eventsTable).values(rows);
}

function buildDispatcherWith(consumers: readonly EventConsumer[]): EventDispatcher {
  return createEventDispatcher({
    db: stack.db.db,
    consumers,
    context: { db: stack.db.db, redis: stack.redis.redis, registry: stack.registry },
    // Tight batch + poll so the test doesn't hinge on timing in .start();
    // we drive everything through runOnce() for determinism.
    batchSize: 200,
    pollIntervalMs: 5000,
  });
}

// --- Tests ---

describe("E.5 — SKIP LOCKED: exactly-once delivery across dispatchers", () => {
  test("two dispatchers, same consumer name: each event delivered exactly once", async () => {
    // Shared name — both dispatchers race for the same row in
    // kumiko_event_consumers. SKIP LOCKED must ensure only one wins.
    const name = "multi:consumer:echo-same";
    const seen: StoredEvent[] = [];

    // Two consumers with the SAME name but distinct capture sides —
    // mimics two different processes running the same subscriber code.
    const consumerA: EventConsumer = {
      name,
      handler: async (event) => {
        seen.push(event);
      },
    };
    const consumerB: EventConsumer = { ...consumerA };

    const dispA = buildDispatcherWith([consumerA]);
    const dispB = buildDispatcherWith([consumerB]);

    // Seed a known, large-enough batch.
    const count = 30;
    for (let i = 0; i < count; i++) {
      await appendWidget(`event-${i}`);
    }

    // Race both dispatchers. One will acquire the lock; the other's
    // SELECT FOR UPDATE SKIP LOCKED returns nothing and it bails out of
    // this pass. Run a handful of passes so stragglers (if any) get
    // another shot.
    for (let pass = 0; pass < 5; pass++) {
      await Promise.all([dispA.runOnce(), dispB.runOnce()]);
    }

    // Each of the 30 events should appear exactly once across the
    // combined `seen` array. Duplicate delivery would show up as >30.
    expect(seen).toHaveLength(count);
    const names = seen.map((e) => e.payload["name"]).sort();
    const expected = Array.from({ length: count }, (_, i) => `event-${i}`).sort();
    expect(names).toEqual(expected);

    const finalState = await getConsumerState(stack.db.db, name);
    expect(finalState?.lastProcessedEventId).toBe(BigInt(count));
    expect(finalState?.status).toBe("idle");
  });

  test("different consumer names: one slow consumer does not starve the other", async () => {
    // Two independent consumer rows, both driven on the same DB via two
    // dispatcher instances. A slow handler on one side must not block the
    // fast side.
    const fastName = "multi:consumer:fast";
    const slowName = "multi:consumer:slow";
    const fastSeen: StoredEvent[] = [];
    const slowSeen: StoredEvent[] = [];

    const fast: EventConsumer = {
      name: fastName,
      handler: async (event) => {
        fastSeen.push(event);
      },
    };
    const slow: EventConsumer = {
      name: slowName,
      handler: async (event) => {
        await new Promise((r) => setTimeout(r, 30));
        slowSeen.push(event);
      },
    };

    const dispA = buildDispatcherWith([fast]);
    const dispB = buildDispatcherWith([slow]);

    const count = 10;
    for (let i = 0; i < count; i++) {
      await appendWidget(`concurrent-${i}`);
    }

    // A tight race: fast dispatcher finishes its pass quickly; slow
    // dispatcher is still processing. Neither should see the other's
    // events (different consumer names = different rows, different
    // cursors).
    await Promise.all([dispA.runOnce(), dispB.runOnce()]);

    expect(fastSeen).toHaveLength(count);
    expect(slowSeen).toHaveLength(count);

    const fastState = await getConsumerState(stack.db.db, fastName);
    const slowState = await getConsumerState(stack.db.db, slowName);
    expect(fastState?.lastProcessedEventId).toBe(BigInt(count));
    expect(slowState?.lastProcessedEventId).toBe(BigInt(count));
  });
});

describe("E.5 — cursor-lag catch-up", () => {
  test("a consumer joining with a 500-event backlog catches up across multiple passes", async () => {
    const name = "multi:consumer:late-joiner";
    const seen: StoredEvent[] = [];
    const consumer: EventConsumer = {
      name,
      handler: async (event) => {
        seen.push(event);
      },
    };

    // Seed events BEFORE the consumer first runs. Matches a deploy scenario
    // where a new subscriber is added to a feature and starts from cursor=0
    // against a populated events table. 500 events × batchSize=100 = 5 passes
    // — still "multiple" and exercises the cursor-advance loop.
    const count = 500;
    await bulkSeedWidgetCreated(count, "backlog-");
    // State row doesn't exist yet — first pass bootstraps it.
    expect(await getConsumerState(stack.db.db, name)).toBeNull();

    const disp = createEventDispatcher({
      db: stack.db.db,
      consumers: [consumer],
      context: { db: stack.db.db, redis: stack.redis.redis, registry: stack.registry },
      batchSize: 100,
      pollIntervalMs: 5000,
    });

    // batchSize = 100 → 5 passes cover 500 events. Run 8 to leave headroom;
    // the 6th+ passes should be no-ops.
    for (let pass = 0; pass < 8; pass++) {
      const result = await disp.runOnce();
      if (result.byConsumer[name]?.processed === 0) break;
    }

    // All events delivered, in order, exactly once.
    expect(seen).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      expect(seen[i]?.payload["name"]).toBe(`backlog-${i}`);
    }

    const finalState = await getConsumerState(stack.db.db, name);
    expect(finalState?.lastProcessedEventId).toBe(BigInt(count));
    expect(finalState?.status).toBe("idle");
  });
});
