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
import { defineFeature } from "@kumiko/framework/engine";
import { createEventsTable, loadAggregate } from "@kumiko/framework/event-store";
import {
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
import { subscriptionFoundationFeature } from "../feature";
import type { SubscriptionProviderPlugin } from "../types";

// =============================================================================
// Mock-plugin für create-checkout-session + create-portal-session-Tests.
// **Pattern-Vorbild:** ai-foundation.integration.ts mit zwei inline-mock-
// plugins. Vermeidet zweiten beforeAll/setupTestStack — selber stack,
// einfach extra-feature im features-array.
// =============================================================================

const mockCheckoutCalls: Array<{
  priceId: string;
  tenantId: string;
  successUrl: string;
  cancelUrl: string;
  providerCustomerId?: string;
}> = [];
const mockPortalCalls: Array<{ providerCustomerId: string; returnUrl: string }> = [];

const mockProviderFeature = defineFeature("test-mock-provider", (r) => {
  r.requires("subscription-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    createCheckoutSession: async (_ctx, options) => {
      mockCheckoutCalls.push({
        priceId: options.priceId,
        tenantId: options.tenantId,
        successUrl: options.successUrl,
        cancelUrl: options.cancelUrl,
        ...(options.providerCustomerId && { providerCustomerId: options.providerCustomerId }),
      });
      return { url: `https://mock.example/checkout/${options.priceId}` };
    },
    createPortalSession: async (_ctx, options) => {
      mockPortalCalls.push({
        providerCustomerId: options.providerCustomerId,
        returnUrl: options.returnUrl,
      });
      return { url: `https://mock.example/portal/${options.providerCustomerId}` };
    },
  };
  r.useExtension("subscriptionProvider", "mock", plugin);
});

// =============================================================================
// Setup
// =============================================================================

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [subscriptionFoundationFeature, mockProviderFeature],
  });
  db = stack.db;
  // subscriptionsProjectionTable wird von setupTestStack automatisch
  // gepusht (r.projection mit `table`-Property → auto-push).
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

    // ES-event archiviert (= audit lebt im event-store, kein separate
    // subscription-event-Tabelle mehr).
    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    expect(esEvents).toHaveLength(1);
    expect(esEvents[0]?.type).toBe("subscription-foundation:event:subscription-created");
    expect(esEvents[0]?.metadata.headers?.["providerEventId"]).toBe("evt_3001_create");
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

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    expect(esEvents).toHaveLength(2); // create + update beide im stream
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

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    expect(esEvents).toHaveLength(1); // dedup'd
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

describe("scenario 5: Provider-Wechsel mid-period (Disney+-Pattern)", () => {
  test("Tenant switcht von Stripe zu PayPal: subscription-row updated providerName, subscription-event-history zeigt beide", async () => {
    // **Disney+-Use-Case:** Tenant hat Stripe-sub, will umsteigen auf
    // PayPal. Cancel des Stripe-sub + neue subscription via PayPal sind
    // zwei getrennte Webhook-events vom Endkunden-Action ausgelöst.
    // Foundation muss damit umgehen können — eine subscription-row
    // pro Tenant, providerName tracked welcher Provider gerade hält.
    const admin = adminFor(3009);

    // Stripe-Sub erzeugt
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_stripe_create",
        providerCustomerId: "cus_stripe",
        providerSubscriptionId: "sub_stripe",
        tier: "pro",
      }),
      admin,
    );

    let subs = (await stack.http.queryOk(
      "subscription-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["providerName"]).toBe("stripe");

    // Stripe-Cancel + PayPal-Create kommen — PayPal-Plugin liefert
    // SubscriptionEvent mit providerName="paypal".
    const paypalEvent = {
      ...buildEvent({
        providerEventId: "I-PAYPAL-NEW",
        providerCustomerId: "PP-CUST-001",
        providerSubscriptionId: "I-PAYPAL-NEW",
        tier: "pro",
      }),
      providerName: "paypal",
    };
    await stack.http.writeOk(SubscriptionFoundationHandlers.processEvent, paypalEvent, admin);

    // subscription-row geupdated, providerName ist jetzt "paypal".
    // **Drift-Pin:** Eine subscription-row pro Tenant — der Wechsel
    // überschreibt die alte Provider-Daten, history liegt in
    // subscription-event-rows.
    subs = (await stack.http.queryOk(
      "subscription-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["providerName"]).toBe("paypal");
    expect(subs.rows[0]?.["providerCustomerId"]).toBe("PP-CUST-001");
    expect(subs.rows[0]?.["providerSubscriptionId"]).toBe("I-PAYPAL-NEW");

    // History: beide events im subscription-stream archiviert
    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    expect(esEvents).toHaveLength(2);
    const providerNames = esEvents
      .map((e) => e.metadata.headers?.["providerName"] as string | undefined)
      .filter((p): p is string => p !== undefined)
      .sort();
    expect(providerNames).toEqual(["paypal", "stripe"]);
  });
});

// =============================================================================
// Scenarios 6+7 — Phase-5.2b write-handlers (create-checkout-session +
// create-portal-session). Foundation-routing-tests; provider-spezifisches
// Verhalten (echte Stripe-checkout-URL) wird in subscription-stripe getestet.
// =============================================================================

describe("scenario 6: create-checkout-session — Plugin-routing", () => {
  test("happy-path: valid provider → URL durchgereicht + plugin mit korrekten args aufgerufen", async () => {
    mockCheckoutCalls.length = 0;
    const admin = adminFor(3009);
    const result = (await stack.http.writeOk(
      "subscription-foundation:write:create-checkout-session",
      {
        providerName: "mock",
        priceId: "price_pro_test",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      },
      admin,
    )) as Record<string, unknown>;

    expect(result["url"]).toBe("https://mock.example/checkout/price_pro_test");
    expect(result["providerName"]).toBe("mock");

    // Drift-pin: foundation-handler reicht alle payload-Felder + die
    // resolved tenantId an den Plugin durch. Wenn jemand silent
    // umbenennt (z.B. successUrl → success_url im handler), würde
    // mockCheckoutCalls die alten Felder vermissen.
    expect(mockCheckoutCalls).toHaveLength(1);
    expect(mockCheckoutCalls[0]).toEqual({
      priceId: "price_pro_test",
      tenantId: admin.tenantId,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
  });

  test("provider not registered → klarer error mit known-list", async () => {
    const admin = adminFor(3010);
    const error = await stack.http.writeErr(
      "subscription-foundation:write:create-checkout-session",
      {
        providerName: "non-existent-provider",
        priceId: "price_test",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      },
      admin,
    );
    expect(JSON.stringify(error)).toMatch(/not registered/);
  });

  test("optional providerCustomerId wird durchgereicht (Plan-Wechsel-Flow)", async () => {
    mockCheckoutCalls.length = 0;
    const admin = adminFor(3012);
    await stack.http.writeOk(
      "subscription-foundation:write:create-checkout-session",
      {
        providerName: "mock",
        priceId: "price_business_test",
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
        providerCustomerId: "cus_existing_xyz",
      },
      admin,
    );
    expect(mockCheckoutCalls[0]?.providerCustomerId).toBe("cus_existing_xyz");
  });
});

describe("scenario 7: create-portal-session — Plugin-routing", () => {
  test("happy-path: tenant hat subscription → portal-URL durchgereicht", async () => {
    mockPortalCalls.length = 0;
    const admin = adminFor(3013);

    // Erst: subscription via process-event erzeugen — providerName "mock"
    // damit Foundation-handler den Plugin via lookup findet.
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      {
        ...buildEvent({
          providerEventId: "evt_3013_create",
          providerCustomerId: "cus_3013",
          providerSubscriptionId: "sub_3013",
        }),
        providerName: "mock",
      },
      admin,
    );

    const result = (await stack.http.writeOk(
      "subscription-foundation:write:create-portal-session",
      { returnUrl: "https://example.com/return" },
      admin,
    )) as Record<string, unknown>;

    expect(result["url"]).toBe("https://mock.example/portal/cus_3013");
    expect(result["providerName"]).toBe("mock");

    // Drift-pin: portal-handler liest providerCustomerId AUS DER DB
    // (subscription-row), nicht aus der payload. Wenn ein Refactor das
    // umstellt (= Tenant könnte fremde portal-sessions öffnen), würde
    // mockPortalCalls den falschen customer-id sehen.
    expect(mockPortalCalls).toHaveLength(1);
    expect(mockPortalCalls[0]).toEqual({
      providerCustomerId: "cus_3013",
      returnUrl: "https://example.com/return",
    });
  });

  test("Tenant ohne subscription → 'no active subscription'-error", async () => {
    const admin = adminFor(3011);
    const error = await stack.http.writeErr(
      "subscription-foundation:write:create-portal-session",
      { returnUrl: "https://example.com/return" },
      admin,
    );
    expect(JSON.stringify(error)).toMatch(/no active subscription/);
  });
});

describe("scenario 8: cancel-event setzt status auf canceled, behält subscription-row", () => {
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
