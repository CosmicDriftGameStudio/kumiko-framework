// Integration test for r.rawTable() — proves the full boot path:
// defineFeature declares a raw table → setupTestStack auto-pushes it →
// INSERT/SELECT against the real DB roundtrip. Plan reference:
// kumiko-platform/docs/plans/architecture/table-ddl-guard.md (Stufe 3).

import { eq, sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { defineFeature } from "../engine";
import { setupTestStack, type TestStack } from "../stack";

// External-system payload cache — the textbook r.rawTable() use case:
// write-only by an integration handler, read-only by a query, never
// event-sourced (the data isn't a domain fact, it's a side-effect
// snapshot).
const stripeWebhookCache = pgTable("rt_int_stripe_webhook_cache", {
  eventId: text("event_id").primaryKey(),
  payload: text("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

const billingFeature = defineFeature("billing-int", (r) => {
  r.rawTable("stripe-webhook-cache", stripeWebhookCache, {
    reason: "external Stripe webhook payload cache — write-only by webhook handler",
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [billingFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("r.rawTable — DB roundtrip via setupTestStack", () => {
  test("table is auto-pushed and accepts INSERT + SELECT", async () => {
    const eventId = "evt_test_123";
    const payload = JSON.stringify({ type: "invoice.paid", amount: 4200 });

    await stack.db.insert(stripeWebhookCache).values({ eventId, payload });

    const rows = await stack.db
      .select()
      .from(stripeWebhookCache)
      .where(eq(stripeWebhookCache.eventId, eventId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toBe(payload);
    expect(rows[0]?.receivedAt).toBeInstanceOf(Date);
  });

  test("registry exposes the raw table with its reason and featureName", () => {
    const all = stack.registry.getAllRawTables();
    const entry = all.get("stripe-webhook-cache");
    expect(entry).toBeDefined();
    expect(entry?.featureName).toBe("billing-int");
    expect(entry?.reason).toContain("Stripe webhook payload cache");
    expect(entry?.table).toBe(stripeWebhookCache);
  });

  test("INSERT bypasses the event store — no kumiko_events row produced", async () => {
    // Proves that the rawTable lives outside the event-sourcing graph:
    // a write to it shouldn't append anything to kumiko_events. If a
    // future regression accidentally routed raw-table writes through
    // the executor, a row would show up here.
    const before = await stack.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM kumiko_events`,
    );
    const beforeCount = Number(before[0]?.count ?? 0);

    await stack.db.insert(stripeWebhookCache).values({
      eventId: "evt_no_event_emitted",
      payload: "{}",
    });

    const after = await stack.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM kumiko_events`,
    );
    const afterCount = Number(after[0]?.count ?? 0);

    expect(afterCount).toBe(beforeCount);
  });
});
