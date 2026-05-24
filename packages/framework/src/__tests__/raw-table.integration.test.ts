// Integration test for r.rawTable() — proves the full boot path:
// defineFeature declares a raw table → setupTestStack auto-pushes it →
// INSERT/SELECT against the real DB roundtrip. Plan reference:
// kumiko-platform/docs/plans/architecture/table-ddl-guard.md (Stufe 3).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { table, text, timestamp } from "../db/dialect";
import { asRawClient, insertOne, selectMany } from "../db/query";
import { defineFeature } from "../engine";
import { setupTestStack, type TestStack, unsafePushTables } from "../stack";

// External-system payload cache — the textbook r.rawTable() use case:
// write-only by an integration handler, read-only by a query, never
// event-sourced (the data isn't a domain fact, it's a side-effect
// snapshot).
const stripeWebhookCache = table("rt_int_stripe_webhook_cache", {
  eventId: text("event_id").primaryKey(),
  payload: text("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

// A second physical table reachable through two distinct r.rawTable
// registrations — pins the seenTables-by-reference dedupe at push time.
// Two logical names, one CREATE.
const sharedSyncCache = table("rt_int_shared_sync_cache", {
  syncId: text("sync_id").primaryKey(),
  payload: text("payload").notNull(),
});

const webhookCacheFeature = defineFeature("webhook-cache", (r) => {
  r.rawTable("stripe", stripeWebhookCache, {
    reason: "external Stripe webhook payload cache — write-only by webhook handler",
  });
  r.rawTable("primary-sync", sharedSyncCache, {
    reason: "shared sync-state cache, primary writer",
  });
  r.rawTable("secondary-sync", sharedSyncCache, {
    reason: "same physical table, different logical role for read consumers",
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [webhookCacheFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("r.rawTable — DB roundtrip via setupTestStack", () => {
  test("table is auto-pushed and accepts INSERT + SELECT", async () => {
    const eventId = "evt_test_123";
    const payload = JSON.stringify({ type: "invoice.paid", amount: 4200 });

    await insertOne(stack.db, stripeWebhookCache, { eventId, payload });

    const rows = await selectMany(stack.db, stripeWebhookCache, { eventId: eventId });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toBe(payload);
    expect(rows[0]?.receivedAt).toBeInstanceOf(Temporal.Instant);
  });

  test("registry exposes the raw table with its reason and featureName", () => {
    const all = stack.registry.getAllRawTables();
    const entry = all.get("stripe");
    expect(entry).toBeDefined();
    expect(entry?.featureName).toBe("webhook-cache");
    expect(entry?.reason).toContain("Stripe webhook payload cache");
    expect(entry?.table).toBe(stripeWebhookCache);
  });

  test("INSERT bypasses the event store — no kumiko_events row produced", async () => {
    // Proves that the rawTable lives outside the event-sourcing graph:
    // a write to it shouldn't append anything to kumiko_events. If a
    // future regression accidentally routed raw-table writes through
    // the executor, a row would show up here.
    const before = await asRawClient(stack.db).unsafe<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM kumiko_events`,
    );
    const beforeCount = Number(before[0]?.count ?? 0);

    await insertOne(stack.db, stripeWebhookCache, {
      eventId: "evt_no_event_emitted",
      payload: "{}",
    });

    const after = await asRawClient(stack.db).unsafe<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM kumiko_events`,
    );
    const afterCount = Number(after[0]?.count ?? 0);

    expect(afterCount).toBe(beforeCount);
  });

  test("two registrations sharing one PgTable result in one CREATE (dedupe by reference)", async () => {
    // primary-sync + secondary-sync both target sharedSyncCache. If the
    // setupTestStack dedupe (seenTables-by-table-reference) had silently
    // broken, beforeAll's setupTestStack would have raised a 42P07 on
    // the second push and never reached this test.
    await insertOne(stack.db, sharedSyncCache, { syncId: "sync_1", payload: "{}" });
    const rows = await selectMany(stack.db, sharedSyncCache, { syncId: "sync_1" });
    expect(rows).toHaveLength(1);
    // Both registrations are visible in the registry — same physical
    // target, different logical handles.
    expect(stack.registry.getAllRawTables().get("primary-sync")?.table).toBe(sharedSyncCache);
    expect(stack.registry.getAllRawTables().get("secondary-sync")?.table).toBe(sharedSyncCache);
  });

  test("a second push on the same rawTable is idempotent — CREATE IF NOT EXISTS", async () => {
    // unsafePushTables uses CREATE TABLE IF NOT EXISTS — idempotent by design.
    await expect(unsafePushTables(stack.db, { idem: stripeWebhookCache })).resolves.toBeUndefined();
  });
});
