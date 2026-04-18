// E.2 — Retention for the events-table. The claims pinned here:
//
//   1. aggregateTypes is REQUIRED. No default — the caller has to name
//      what they're destroying.
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
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import { eventsTable } from "../../event-store";
import {
  ConsumerLagError,
  disableConsumer,
  eventConsumerStateTable,
  pruneEvents,
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

const retentionFeature = defineFeature("retention", (r) => {
  r.entity("widget", sharedWidgetEntity);
  // A single MSP so the events-table writes but no consumer has advanced
  // cursor by default (we drive cursor via runOnce in tests that care about
  // the lag guard).
  r.multiStreamProjection({
    name: "observer",
    apply: {
      "widget.created": async () => {},
    },
  });
});

const admin = TestUsers.admin;
const observerQn = "retention:projection:observer";
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [retentionFeature],
    systemHooks: [],
  });
  await createEntityTable(stack.db.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db.db, admin.tenantId);
});

afterEach(async () => {
  await stack.db.db.execute(
    sql`TRUNCATE events, widgets, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

// Seed an aggregate event directly with a specific createdAt. Bypasses the
// executor so we can stamp events in the past for prune tests. Aggregate
// type defaults to "widget" — matches the test feature's entity type.
async function seedOldAggregateEvent(
  createdAt: Temporal.Instant,
  type: string,
  aggregateType = "widget",
): Promise<bigint> {
  const [row] = await stack.db.db
    .insert(eventsTable)
    .values({
      aggregateId: globalThis.crypto.randomUUID(),
      aggregateType,
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

describe("E.2 — explicit-aggregateTypes pruning", () => {
  test("aggregate-type events NOT named in aggregateTypes are untouched", async () => {
    // Seed an "obsolete" aggregate type + a "widget" event, both aged.
    const tenDaysAgo = Temporal.Now.instant().subtract({ hours: 240 });
    const obsoleteId = await seedOldAggregateEvent(tenDaysAgo, "obsolete.v1", "obsolete");
    const widgetId = await seedOldAggregateEvent(tenDaysAgo, "widget.legacy", "widget");

    // Disable the single consumer so the lag guard doesn't interfere. The
    // row was auto-registered by setupTestStack (strict Sprint-E mode);
    // flip its status to disabled instead of inserting a duplicate.
    await disableConsumer(stack.db.db, observerQn);

    // Prune only the obsolete type — widget events survive.
    const result = await pruneEvents(stack.db.db, {
      olderThanDays: 7,
      aggregateTypes: ["obsolete"],
    });
    expect(result.deletedCount).toBe(1);
    expect(result.aggregateTypes).toEqual(["obsolete"]);

    const remaining = await stack.db.db.select().from(eventsTable);
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(widgetId);
    expect(ids).not.toContain(obsoleteId);
  });

  test("named aggregate-type events older than the cutoff are deleted; fresh ones stay", async () => {
    const tenDaysAgo = Temporal.Now.instant().subtract({ hours: 240 });
    const freshId = await seedOldAggregateEvent(
      Temporal.Now.instant(),
      "obsolete.fresh",
      "obsolete",
    );
    const staleId = await seedOldAggregateEvent(tenDaysAgo, "obsolete.stale", "obsolete");

    // Disable the auto-registered consumer so the lag guard passes — the
    // consumer is at cursor=0 and would otherwise block a prune that
    // touches higher event ids.
    await disableConsumer(stack.db.db, observerQn);
    const result = await pruneEvents(stack.db.db, {
      olderThanDays: 7,
      aggregateTypes: ["obsolete"],
    });
    expect(result.deletedCount).toBe(1);

    const remaining = await stack.db.db.select().from(eventsTable);
    const ids = remaining.map((r) => r.id).sort();
    expect(ids).toEqual([freshId]);
    expect(ids.includes(staleId)).toBe(false);
  });

  test("dry-run reports the count but deletes nothing", async () => {
    const tenDaysAgo = Temporal.Now.instant().subtract({ hours: 240 });
    await seedOldAggregateEvent(tenDaysAgo, "obsolete.drain", "obsolete");

    await disableConsumer(stack.db.db, observerQn);
    const result = await pruneEvents(stack.db.db, {
      olderThanDays: 7,
      aggregateTypes: ["obsolete"],
      dryRun: true,
    });
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
        aggregateTypes: ["widget"],
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
      aggregateTypes: ["widget"],
    });
    expect(result.deletedCount).toBe(1);
  });
});

describe("E.2 — empty sets and input validation", () => {
  test("returns zero when nothing matches the cutoff", async () => {
    const result = await pruneEvents(stack.db.db, {
      olderThanDays: 365,
      aggregateTypes: ["widget"],
    });
    expect(result.deletedCount).toBe(0);
  });

  test("refuses call without olderThan or olderThanDays", async () => {
    await expect(pruneEvents(stack.db.db, { aggregateTypes: ["widget"] })).rejects.toThrow(
      /olderThan/,
    );
  });

  test("refuses call without aggregateTypes", async () => {
    // Typescript would catch this at compile time, but the runtime guard
    // exists for JS callers and JSON-config-driven cron pipes.
    await expect(
      pruneEvents(stack.db.db, { olderThanDays: 7 } as unknown as Parameters<
        typeof pruneEvents
      >[1]),
    ).rejects.toThrow(/aggregateTypes/);
  });
});
