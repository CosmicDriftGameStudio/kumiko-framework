// E.2 — Retention for the events-table. The claims pinned here:
//
//   1. Default prune targets ONLY aggregateType="pubsub". Aggregate events
//      (source of truth for loadAggregate / projections / asOf queries)
//      are never touched unless the caller explicitly passes
//      aggregateTypes including them.
//   2. The consumer-lag guard: if any ACTIVE consumer's cursor is below
//      the largest candidate event id, pruning refuses with
//      ConsumerLagError. Disabled consumers are ignored (ops parks them
//      before a big prune).
//   3. Dry-run: reports the count, deletes nothing.
//   4. olderThanDays / olderThan convenience: both resolve to the same
//      cutoff semantics (createdAt < cutoff).

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { eventsTable } from "../../event-store";
import {
  ConsumerLagError,
  disableConsumer,
  eventConsumerStateTable,
  PUBSUB_AGGREGATE_TYPE,
  pruneEvents,
} from "../../pipeline";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";

// --- Fixture ---

const retentionEntity = createEntity({
  table: "retention_widgets",
  idType: "uuid",
  fields: { name: createTextField({ required: true }) },
  softDelete: true,
});
const retentionTable = buildDrizzleTable("retentionWidget", retentionEntity);
const executor = createEventStoreExecutor(retentionTable, retentionEntity, {
  entityName: "retentionWidget",
});

const retentionFeature = defineFeature("retention", (r) => {
  r.entity("retentionWidget", retentionEntity);
  // A single subscriber so the events-table writes but no consumer has
  // advanced cursor by default (we drive cursor via runOnce in tests that
  // care about the lag guard).
  r.postEvent("observer", async () => {});
});

const admin = TestUsers.admin;
const observerQn = "retention:consumer:observer";
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [retentionFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, retentionEntity, "retentionWidget");
  tdb = createTenantDb(stack.db.db, admin.tenantId);
});

afterEach(async () => {
  await stack.db.db.execute(
    sql`TRUNCATE events, retention_widgets, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
});

// Insert a pub/sub event directly with a specific createdAt. Bypasses
// ctx.emit so we can stamp events in the past for prune tests.
async function seedOldPubsubEvent(createdAt: Date, type: string): Promise<bigint> {
  const [row] = await stack.db.db
    .insert(eventsTable)
    .values({
      aggregateId: globalThis.crypto.randomUUID(),
      aggregateType: PUBSUB_AGGREGATE_TYPE,
      tenantId: admin.tenantId,
      version: 1,
      type,
      payload: {},
      metadata: { userId: admin.id },
      createdAt,
      createdBy: admin.id,
    })
    .returning({ id: eventsTable.id });
  if (!row) throw new Error("seed failed");
  return row.id;
}

async function appendAggregateWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

// --- Tests ---

describe("E.2 — default prunes only pubsub events", () => {
  test("aggregate events remain untouched even when older than the cutoff", async () => {
    // One fresh aggregate event (created now)
    await appendAggregateWidget("current");
    // Stamp an aggregate event as old — we bypass the guard by direct
    // UPDATE so we can observe "aged" aggregate rows. Cursor at 0 means
    // no consumer has moved yet; we disable the observer so the lag guard
    // doesn't trip for THIS test (the guard has its own test below).
    await stack.db.db.execute(
      sql`UPDATE events SET created_at = now() - interval '30 days' WHERE id = 1`,
    );

    // Disable the single consumer so the lag guard doesn't interfere.
    // Ensure the row exists first.
    await stack.db.db.insert(eventConsumerStateTable).values({
      name: observerQn,
      lastProcessedEventId: 0n,
      status: "disabled",
    });

    const result = await pruneEvents(stack.db.db, { olderThanDays: 7 });
    expect(result.deletedCount).toBe(0);

    const remaining = await stack.db.db.select().from(eventsTable);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.aggregateType).toBe("retentionWidget");
  });

  test("pubsub events older than the cutoff are deleted; fresh ones stay", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const freshPubsubId = await seedOldPubsubEvent(new Date(), "fresh.pubsub");
    const oldPubsubId = await seedOldPubsubEvent(tenDaysAgo, "stale.pubsub");

    // No registered consumers → lag guard passes trivially.
    const result = await pruneEvents(stack.db.db, { olderThanDays: 7 });
    expect(result.deletedCount).toBe(1);
    expect(result.aggregateTypes).toEqual([PUBSUB_AGGREGATE_TYPE]);

    const remaining = await stack.db.db.select().from(eventsTable);
    const ids = remaining.map((r) => r.id).sort();
    expect(ids).toEqual([freshPubsubId]);
    expect(ids.includes(oldPubsubId)).toBe(false);
  });

  test("dry-run reports the count but deletes nothing", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await seedOldPubsubEvent(tenDaysAgo, "dry.pubsub");

    const result = await pruneEvents(stack.db.db, { olderThanDays: 7, dryRun: true });
    expect(result.deletedCount).toBe(1);
    expect(result.dryRun).toBe(true);

    const remaining = await stack.db.db.select().from(eventsTable);
    expect(remaining).toHaveLength(1);
  });
});

describe("E.2 — consumer-lag guard", () => {
  test("throws ConsumerLagError when an active consumer has not caught up", async () => {
    // Append 3 aggregate events. Consumer will process only the first,
    // stop advancing, and sit at cursor=1. Then we try to prune — the
    // guard should see candidates up to id=3 and throw.
    //
    // Use an aggregateType override so the aggregate events become prune
    // candidates (pubsub alone wouldn't hit the lag guard here).
    await appendAggregateWidget("one");
    await appendAggregateWidget("two");
    await appendAggregateWidget("three");

    // Only let the first one through.
    await stack.eventDispatcher?.runOnce();
    // Force cursor to 1 so the guard sees "consumer at 1, max candidate 3".
    await stack.db.db
      .update(eventConsumerStateTable)
      .set({ lastProcessedEventId: 1n, status: "idle" })
      .where(eq(eventConsumerStateTable.name, observerQn));

    // Age all three events past the cutoff.
    await stack.db.db.execute(sql`UPDATE events SET created_at = now() - interval '30 days'`);

    await expect(
      pruneEvents(stack.db.db, {
        olderThanDays: 7,
        aggregateTypes: ["retentionWidget"],
      }),
    ).rejects.toThrow(ConsumerLagError);
  });

  test("disabled consumers are ignored by the lag guard", async () => {
    await appendAggregateWidget("solo");
    await stack.eventDispatcher?.runOnce();
    await disableConsumer(stack.db.db, observerQn);

    // Cursor is at 1 but consumer is disabled — should be skipped.
    await stack.db.db.execute(sql`UPDATE events SET created_at = now() - interval '30 days'`);

    const result = await pruneEvents(stack.db.db, {
      olderThanDays: 7,
      aggregateTypes: ["retentionWidget"],
    });
    expect(result.deletedCount).toBe(1);
  });
});

describe("E.2 — empty sets and input validation", () => {
  test("returns zero when nothing matches the cutoff", async () => {
    const result = await pruneEvents(stack.db.db, { olderThanDays: 365 });
    expect(result.deletedCount).toBe(0);
  });

  test("refuses call without olderThan or olderThanDays", async () => {
    await expect(pruneEvents(stack.db.db, {})).rejects.toThrow(/olderThan/);
  });
});
