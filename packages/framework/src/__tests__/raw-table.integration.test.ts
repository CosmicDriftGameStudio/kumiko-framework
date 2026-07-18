// Integration test for r.rawTable() — proves the full boot path:
// defineFeature declares a raw table → setupTestStack auto-pushes it →
// INSERT/SELECT against the real DB roundtrip. Plan reference:
// kumiko-platform/docs/plans/architecture/table-ddl-guard.md (Stufe 3).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineUnmanagedTable } from "../db/entity-table-meta";
import { asRawClient, insertOne, selectMany } from "../db/query";
import { defineFeature } from "../engine";
import { setupTestStack, type TestStack, unsafePushTables } from "../stack";

// External-system payload cache — the textbook r.rawTable() use case:
// write-only by an integration handler, read-only by a query, never
// event-sourced (the data isn't a domain fact, it's a side-effect
// snapshot).
const stripeWebhookCacheMeta = defineUnmanagedTable({
  tableName: "rt_int_stripe_webhook_cache",
  columns: [
    { name: "event_id", pgType: "text", notNull: true, primaryKey: true },
    { name: "payload", pgType: "text", notNull: true },
    { name: "received_at", pgType: "timestamptz", notNull: true, defaultSql: "now()" },
  ],
});

const webhookCacheFeature = defineFeature("webhook-cache", (r) => {
  r.rawTable(stripeWebhookCacheMeta, {
    reason: "external Stripe webhook payload cache — write-only by webhook handler",
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

    await insertOne(stack.db, stripeWebhookCacheMeta, { eventId, payload });

    const rows = await selectMany(stack.db, stripeWebhookCacheMeta, { eventId: eventId });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toBe(payload);
    expect(rows[0]?.receivedAt).toBeInstanceOf(Temporal.Instant);
  });

  test("registry exposes the raw table with its reason and featureName", () => {
    const all = stack.registry.getAllRawTables();
    const entry = all.get("rt_int_stripe_webhook_cache");
    expect(entry).toBeDefined();
    expect(entry?.featureName).toBe("webhook-cache");
    expect(entry?.reason).toContain("Stripe webhook payload cache");
    expect(entry?.meta).toBe(stripeWebhookCacheMeta);
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

    await insertOne(stack.db, stripeWebhookCacheMeta, {
      eventId: "evt_no_event_emitted",
      payload: "{}",
    });

    const after = await asRawClient(stack.db).unsafe<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM kumiko_events`,
    );
    const afterCount = Number(after[0]?.count ?? 0);

    expect(afterCount).toBe(beforeCount);
  });

  test("a second push on the same rawTable is idempotent — CREATE IF NOT EXISTS", async () => {
    // unsafePushTables uses CREATE TABLE IF NOT EXISTS — idempotent by design.
    await expect(
      unsafePushTables(stack.db, { idem: stripeWebhookCacheMeta }),
    ).resolves.toBeUndefined();
  });
});
