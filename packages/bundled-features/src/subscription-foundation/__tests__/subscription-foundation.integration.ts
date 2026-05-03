// Integration-test for subscription-foundation. Treibt den process-
// event-handler durch den full Dispatcher + DB.
//
// **Mock-Plugin-Strategie (analog ai-foundation):** wir testen NICHT
// die Stripe-/Mollie-spezifischen Plugins (das passiert in deren
// eigenen feature.test.ts in Phase 5.2/5.3). Hier: direkter ctx.write
// auf process-event mit normalisiertem SubscriptionEvent als payload —
// beweist die Foundation-eigene Verdrahtung (atomic insert + upsert,
// Idempotency via deterministic aggregate-ids, tenant-isolation).
//
// Webhook-Handler-Factory (createSubscriptionWebhookHandler) wird in
// einem separaten Test mit Hono-mock geprüft.

import type { DbConnection } from "@kumiko/framework/db";
import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@kumiko/framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { subscriptionAggregateId } from "../aggregate-id";
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../constants";
import { subscriptionEntity, subscriptionEventEntity } from "../entities";
import { subscriptionFoundationFeature } from "../feature";

// =============================================================================
// Setup
// =============================================================================

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [subscriptionFoundationFeature],
  });
  db = stack.db;
  await createEntityTable(db, subscriptionEntity);
  await createEntityTable(db, subscriptionEventEntity);
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

function buildEvent(
  overrides: Partial<{
    providerEventId: string;
    type: string;
    status: string;
    tier: string;
    providerCustomerId: string;
    providerSubscriptionId: string;
    currentPeriodEndIso: string;
    rawPayload: string;
  }> = {},
) {
  return {
    providerEventId: overrides.providerEventId ?? "evt_test_default",
    providerName: "stripe",
    type: overrides.type ?? SubscriptionEventTypes.created,
    providerCustomerId: overrides.providerCustomerId ?? "cus_default",
    providerSubscriptionId: overrides.providerSubscriptionId ?? "sub_default",
    status: overrides.status ?? SubscriptionStatuses.active,
    tier: overrides.tier ?? "pro",
    currentPeriodEndIso: overrides.currentPeriodEndIso ?? "2026-06-01T00:00:00Z",
    rawPayload: overrides.rawPayload ?? '{"raw":"payload"}',
  };
}

// =============================================================================
// Scenarios
// =============================================================================

describe("scenario 1: webhook-event creates subscription + audit-row", () => {
  test("first event for tenant → subscription-row + subscription-event-row erzeugt", async () => {
    const admin = adminFor(3001);
    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3001_create",
        providerCustomerId: "cus_3001",
        providerSubscriptionId: "sub_3001",
      }),
      admin,
    )) as Record<string, unknown>;

    expect(result["duplicate"]).toBe(false);
    expect(result["subscriptionAggregateId"]).toBe(subscriptionAggregateId(admin.tenantId));

    // subscription-row sichtbar via list-query
    const subs = (await stack.http.queryOk(
      "subscription-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["tier"]).toBe("pro");
    expect(subs.rows[0]?.["providerCustomerId"]).toBe("cus_3001");

    // subscription-event-row archiviert
    const events = (await stack.http.queryOk(
      "subscription-foundation:query:subscription-event:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.["providerEventId"]).toBe("evt_3001_create");
    expect(events.rows[0]?.["eventType"]).toBe(SubscriptionEventTypes.created);
  });
});

describe("scenario 2: webhook-update upserts subscription, archiviert weiteren event", () => {
  test("zweiter event für selben Tenant → subscription geupdated, beide events in audit", async () => {
    const admin = adminFor(3002);

    // create
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3002_create",
        providerCustomerId: "cus_3002",
        providerSubscriptionId: "sub_3002",
        tier: "pro",
      }),
      admin,
    );

    // update — same subscription, neuer tier
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3002_update",
        type: SubscriptionEventTypes.updated,
        providerCustomerId: "cus_3002",
        providerSubscriptionId: "sub_3002",
        tier: "business", // upgrade
      }),
      admin,
    );

    const subs = (await stack.http.queryOk(
      "subscription-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1); // immer noch 1 row, geupdated
    expect(subs.rows[0]?.["tier"]).toBe("business");

    const events = (await stack.http.queryOk(
      "subscription-foundation:query:subscription-event:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(events.rows).toHaveLength(2); // create + update beide archiviert
  });
});

describe("scenario 3: idempotency — webhook-retry mit selber providerEventId", () => {
  test("zweiter call mit gleichem providerEventId → duplicate=true, kein zweiter event-row", async () => {
    const admin = adminFor(3003);

    const first = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3003_retry",
        providerCustomerId: "cus_3003",
        providerSubscriptionId: "sub_3003",
      }),
      admin,
    )) as Record<string, unknown>;
    expect(first["duplicate"]).toBe(false);

    const second = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3003_retry",
        providerCustomerId: "cus_3003",
        providerSubscriptionId: "sub_3003",
        tier: "business", // anderer tier — sollte IGNORIERT werden weil duplicate
      }),
      admin,
    )) as Record<string, unknown>;
    expect(second["duplicate"]).toBe(true);

    // Drift-Pin: subscription bleibt beim ersten tier — der duplicate-
    // event hat den state NICHT überschrieben (wäre data-loss bei
    // out-of-order webhook-retries).
    const subs = (await stack.http.queryOk(
      "subscription-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows[0]?.["tier"]).toBe("pro");

    const events = (await stack.http.queryOk(
      "subscription-foundation:query:subscription-event:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(events.rows).toHaveLength(1); // dedup'd
  });
});

describe("scenario 4: tenant-isolation", () => {
  test("Tenant A's subscription leakt nicht in die Liste von Tenant B", async () => {
    const adminA = adminFor(3004);
    const adminB = adminFor(3005);

    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_A",
        providerCustomerId: "cus_A",
        providerSubscriptionId: "sub_A",
        tier: "pro",
      }),
      adminA,
    );
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_B",
        providerCustomerId: "cus_B",
        providerSubscriptionId: "sub_B",
        tier: "business",
      }),
      adminB,
    );

    const subsA = (await stack.http.queryOk(
      "subscription-foundation:query:subscription:list",
      {},
      adminA,
    )) as { rows: Array<Record<string, unknown>> };
    const subsB = (await stack.http.queryOk(
      "subscription-foundation:query:subscription:list",
      {},
      adminB,
    )) as { rows: Array<Record<string, unknown>> };

    expect(subsA.rows).toHaveLength(1);
    expect(subsA.rows[0]?.["tier"]).toBe("pro");
    expect(subsB.rows).toHaveLength(1);
    expect(subsB.rows[0]?.["tier"]).toBe("business");
  });

  test("Idempotency-Anker ist tenant-scoped — selber providerEventId für ZWEI Tenants ist NICHT duplicate", async () => {
    // Edge-case: Stripe verteilt eventIds global eindeutig. Aber
    // theoretisch könnte ein App-Owner mehrere Stripe-Accounts haben
    // (z.B. test/prod-Mix in dev) und gleiche eventIds sehen. Unser
    // aggregate-id ist (tenantId, providerName, providerEventId) — also
    // ist eventId+tenant-A unabhängig von eventId+tenant-B.
    const adminA = adminFor(3006);
    const adminB = adminFor(3007);
    const SHARED_EVT = "evt_shared_id";

    const a = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: SHARED_EVT,
        providerCustomerId: "cus_a_shared",
        providerSubscriptionId: "sub_a_shared",
      }),
      adminA,
    )) as Record<string, unknown>;
    const b = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: SHARED_EVT,
        providerCustomerId: "cus_b_shared",
        providerSubscriptionId: "sub_b_shared",
      }),
      adminB,
    )) as Record<string, unknown>;

    expect(a["duplicate"]).toBe(false);
    expect(b["duplicate"]).toBe(false); // anderer tenant → kein duplicate
  });
});

describe("scenario 5: cancel-event setzt status auf canceled, behält subscription-row", () => {
  test("subscription.canceled event flippt status, subscription-row bleibt", async () => {
    const admin = adminFor(3008);

    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3008_create",
        providerCustomerId: "cus_3008",
        providerSubscriptionId: "sub_3008",
        status: SubscriptionStatuses.active,
        tier: "pro",
      }),
      admin,
    );

    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3008_cancel",
        type: SubscriptionEventTypes.canceled,
        providerCustomerId: "cus_3008",
        providerSubscriptionId: "sub_3008",
        status: SubscriptionStatuses.canceled,
        tier: "free", // downgrade auf free
      }),
      admin,
    );

    const subs = (await stack.http.queryOk(
      "subscription-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1); // row bleibt für audit-history
    expect(subs.rows[0]?.["status"]).toBe(SubscriptionStatuses.canceled);
    expect(subs.rows[0]?.["tier"]).toBe("free");
  });
});
