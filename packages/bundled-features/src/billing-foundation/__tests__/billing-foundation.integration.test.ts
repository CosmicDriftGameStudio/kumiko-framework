// Integration test for subscription-foundation. Drives the process-event handler
// through the full Dispatcher + DB.
//
// **Mock-plugin strategy (analogous to ai-foundation):** we do NOT test the
// Stripe-/Mollie-specific plugins here (their own feature.test.ts files cover
// those). Instead, we call ctx.dispatch.write directly on process-event with a
// normalized SubscriptionEvent payload to verify the foundation wiring:
// atomic insert + upsert, idempotency via deterministic aggregate IDs, and
// tenant isolation.
//
// The webhook route (createSubscriptionWebhookRoute) has dedicated coverage
// in webhook-handler.integration.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { paymentAggregateId, subscriptionAggregateId } from "../aggregate-id.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import { paymentsProjectionTable, subscriptionsProjectionTable } from "../projection.ts";
import type { PaymentEvent, SubscriptionProviderPlugin } from "../types.ts";
import {
  BillingEventKinds,
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../web/constants.ts";
import { createSubscriptionWebhookRoute } from "../webhook-handler.ts";

// =============================================================================
// Mock plugin for create-checkout-session and create-portal-session tests.
// Uses the same stack with an additional feature instead of a second
// beforeAll/setupTestStack call.
// =============================================================================

const mockCheckoutCalls: Array<{
  priceId: string;
  tenantId: string;
  successUrl: string;
  cancelUrl: string;
  providerCustomerId?: string;
  mode?: "subscription" | "payment";
}> = [];
const mockPortalCalls: Array<{ providerCustomerId: string; returnUrl: string }> = [];

const mockProviderFeature = defineFeature("test-mock-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    // Only the two tiers scenario 6's subscription-mode checkouts actually
    // exercise — the hardened create-checkout-session now requires every
    // mode:"subscription" priceId to resolve through priceToTier.
    priceToTier: { price_pro_test: "pro", price_business_test: "business" },
    oneOffPriceIds: ["price_topup_test"],
    createCheckoutSession: async (_ctx, options) => {
      mockCheckoutCalls.push({
        priceId: options.priceId,
        tenantId: options.tenantId,
        successUrl: options.successUrl,
        cancelUrl: options.cancelUrl,
        ...(options.providerCustomerId && { providerCustomerId: options.providerCustomerId }),
        ...(options.mode && { mode: options.mode }),
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

// Second mock provider — parses its rawBody straight into a PaymentEvent
// (no real Stripe-signing needed here, that's subscription-stripe's job).
// Exercises the webhook-handler's payment branch end-to-end (scenario 11).
const mockPaymentProviderFeature = defineFeature("test-mock-payment-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async (rawBody): Promise<PaymentEvent | null> => {
      const parsed = JSON.parse(rawBody) as Record<string, string>;
      return {
        kind: BillingEventKinds.payment,
        providerEventId: parsed["providerEventId"] ?? "evt_mock_payment",
        providerName: "mock-payment",
        tenantId: parsed["tenantId"] ?? "tenant-mock",
        providerCustomerId: parsed["providerCustomerId"] ?? "cus_mock",
        priceId: parsed["priceId"] ?? "price_mock",
      };
    },
  };
  r.useExtension("subscriptionProvider", "mock-payment", plugin);
});

// =============================================================================
// Setup
// =============================================================================

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature({ baseUrl: "https://example.com" }),
      mockProviderFeature,
      mockPaymentProviderFeature,
    ],
    // Scenario 11 exercises the real payment-branch of the webhook route
    // (webhook-handler.ts) mounted through the same stack — no hand-rolled
    // Hono app, real HTTP via stack.app.
    extraRoutes: [createSubscriptionWebhookRoute()],
  });
  db = stack.db;
  // setupTestStack automatically pushes subscriptionsProjectionTable
  // (`r.projection` with a `table` property triggers auto-push).
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  // providerCustomerId/providerSubscriptionId are `personal: "tenant"`
  // PII-subject fields — no executor wires the KMS automatically here (raw r.projection,
  // see feature.ts), so process-event.write.ts calls configuredPiiSubjectKms()
  // directly and needs one configured, same as run{Prod,Dev}App do at boot.
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
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
    cancelAtIso: string | null;
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
    // `cancelAtIso` stays entirely absent from the payload unless an override
    // sets it — undefined (key omitted) vs. null (explicit clear) is the
    // 3-way distinction cancelAtSetFromPayload relies on; a `?? undefined`
    // default here would collapse "omitted" into "explicit null" and hide a
    // regression where a later event without the field wipes a prior value.
    ...(overrides.cancelAtIso !== undefined && { cancelAtIso: overrides.cancelAtIso }),
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
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["tier"]).toBe("pro");
    expect(subs.rows[0]?.["providerCustomerId"]).toBe("cus_3001");

    // The event-store retains the audit history; no separate
    // subscription-event table is used.
    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    expect(esEvents).toHaveLength(1);
    expect(esEvents[0]?.type).toBe("billing-foundation:event:subscription-created");
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
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1); // Still one row because the existing row is updated.
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
        tier: "business", // A duplicate must not overwrite the existing tier.
      }),
      admin,
    )) as Record<string, unknown>;
    expect(second["duplicate"]).toBe(true);

    // Invariant: the subscription retains its initial tier because the duplicate
    // event must not overwrite state; doing so would lose data on
    // out-of-order webhook retries.
    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
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
      "billing-foundation:query:subscription:list",
      {},
      adminA,
    )) as { rows: Array<Record<string, unknown>> };
    const subsB = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      adminB,
    )) as { rows: Array<Record<string, unknown>> };

    expect(subsA.rows).toHaveLength(1);
    expect(subsA.rows[0]?.["tier"]).toBe("pro");
    expect(subsB.rows).toHaveLength(1);
    expect(subsB.rows[0]?.["tier"]).toBe("business");
  });

  test("Idempotency-Anker ist tenant-scoped — selber providerEventId für ZWEI Tenants ist NICHT duplicate", async () => {
    // Edge case: although Stripe event IDs are globally unique, an app owner
    // could use multiple Stripe accounts (for example, a test/production mix
    // during development) and receive the same event ID. The aggregate ID is
    // (tenantId, providerName, providerEventId), so the same event ID is
    // independent for tenant A and tenant B.
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
    expect(b["duplicate"]).toBe(false); // A different tenant is not a duplicate.
  });
});

describe("scenario 5: Provider-Wechsel mid-period (Disney+-Pattern)", () => {
  test("Tenant switcht von Stripe zu PayPal: subscription-row updated providerName, subscription-event-history zeigt beide", async () => {
    // **Disney+ use case:** a tenant switches from Stripe to PayPal. Canceling
    // the Stripe subscription and creating the PayPal subscription produce
    // two separate webhook events from the customer's action. The foundation
    // must support one subscription row per tenant while tracking the current
    // provider in providerName.
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
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["providerName"]).toBe("stripe");

    // Stripe cancellation and PayPal creation arrive; the PayPal plugin
    // supplies a SubscriptionEvent with providerName="paypal".
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

    // The tenant retains one subscription row, so the provider switch replaces
    // the current provider data while the event history remains in the
    // subscription event stream.
    subs = (await stack.http.queryOk("billing-foundation:query:subscription:list", {}, admin)) as {
      rows: Array<Record<string, unknown>>;
    };
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
// Scenarios 6+7 — write handlers for create-checkout-session and
// create-portal-session. These test foundation routing; provider-specific
// behavior, such as a real Stripe checkout URL, is tested in
// subscription-stripe.
// =============================================================================

describe("scenario 6: create-checkout-session — Plugin-routing", () => {
  test("happy-path: valid provider → URL durchgereicht + plugin mit korrekten args aufgerufen", async () => {
    mockCheckoutCalls.length = 0;
    // Not 3009 — scenario 5 reuses that tenant number and leaves it with a
    // non-terminal "pro" subscription; openCheckout's new existing-
    // subscription conflict-gate would reject this checkout for it.
    const admin = adminFor(3016);
    const result = (await stack.http.writeOk(
      "billing-foundation:write:create-checkout-session",
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

    // The foundation handler must pass every payload field and the resolved
    // tenantId to the plugin. Renaming a field silently (for example,
    // successUrl → success_url in the handler) would make the mock calls
    // lose the original field.
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
      "billing-foundation:write:create-checkout-session",
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
    // Not 3012 — that tenant already gets its own subscription in the
    // crypto-shredding test further down and would collide.
    const admin = adminFor(3018);

    // The provider customer-id must belong to the caller's own subscription
    // (even if canceled) — otherwise the foreign_provider_customer guard fires.
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      {
        ...buildEvent({
          providerEventId: "evt_3018_create",
          providerCustomerId: "cus_existing_xyz",
          providerSubscriptionId: "sub_3018",
          status: SubscriptionStatuses.canceled,
        }),
        providerName: "mock",
      },
      admin,
    );

    await stack.http.writeOk(
      "billing-foundation:write:create-checkout-session",
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

  test("fremde providerCustomerId wird abgelehnt (foreign_provider_customer)", async () => {
    mockCheckoutCalls.length = 0;
    const other = adminFor(3019);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      {
        ...buildEvent({
          providerEventId: "evt_3019_create",
          providerCustomerId: "cus_belongs_to_tenant_3019",
          providerSubscriptionId: "sub_3019",
        }),
        providerName: "mock",
      },
      other,
    );

    const admin = adminFor(3017);
    const error = await stack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock",
        priceId: "price_pro_test",
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
        providerCustomerId: "cus_belongs_to_tenant_3019",
      },
      admin,
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe("billing-foundation.errors.foreignProviderCustomer");
    expect(mockCheckoutCalls).toHaveLength(0);
  });

  test("fremde providerCustomerId wird auch im mode:payment abgelehnt", async () => {
    mockCheckoutCalls.length = 0;
    const admin = adminFor(3020);
    const error = await stack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock",
        priceId: "price_topup_test",
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
        providerCustomerId: "cus_belongs_to_tenant_3019",
        mode: "payment",
      },
      admin,
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe("billing-foundation.errors.foreignProviderCustomer");
    expect(mockCheckoutCalls).toHaveLength(0);
  });

  test("optional mode wird durchgereicht (One-off-Payment-Flow, fw#2755)", async () => {
    mockCheckoutCalls.length = 0;
    const admin = adminFor(3014);
    await stack.http.writeOk(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock",
        priceId: "price_topup_test",
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
        mode: "payment",
      },
      admin,
    );
    expect(mockCheckoutCalls).toHaveLength(1);
    expect(mockCheckoutCalls[0]?.mode).toBe("payment");
  });

  test("mode omitted → plugin receives no mode field (Regression-Pin für bestehende Aufrufer)", async () => {
    mockCheckoutCalls.length = 0;
    const admin = adminFor(3015);
    await stack.http.writeOk(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock",
        priceId: "price_pro_test",
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
      },
      admin,
    );
    expect(mockCheckoutCalls).toHaveLength(1);
    expect(mockCheckoutCalls[0]?.mode).toBeUndefined();
  });
});

describe("scenario 7: create-portal-session — Plugin-routing", () => {
  test("happy-path: tenant hat subscription → portal-URL durchgereicht", async () => {
    mockPortalCalls.length = 0;
    const admin = adminFor(3013);

    // Create the subscription through process-event with providerName "mock"
    // so the foundation handler can find the plugin.
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
      "billing-foundation:write:create-portal-session",
      {},
      admin,
    )) as Record<string, unknown>;

    expect(result["url"]).toBe("https://mock.example/portal/cus_3013");
    expect(result["providerName"]).toBe("mock");

    // The portal handler reads providerCustomerId from the database
    // (the subscription row), not from the payload. Reading it from the
    // payload could let a tenant open another tenant's portal session.
    // returnUrl is computed by the server (portalReturnUrl); without a
    // mounted catalog here, it falls back to baseUrl.
    expect(mockPortalCalls).toHaveLength(1);
    expect(mockPortalCalls[0]).toEqual({
      providerCustomerId: "cus_3013",
      returnUrl: "https://example.com",
    });
  });

  test("Tenant ohne subscription → 'no active subscription'-error", async () => {
    const admin = adminFor(3011);
    const error = await stack.http.writeErr(
      "billing-foundation:write:create-portal-session",
      {},
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
        tier: "free", // Downgrade to the free tier.
      }),
      admin,
    );

    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1); // The row remains so its audit history is preserved.
    expect(subs.rows[0]?.["status"]).toBe(SubscriptionStatuses.canceled);
    expect(subs.rows[0]?.["tier"]).toBe("free");
  });
});

describe("scenario 8b: cancelAt — set / leave-unchanged / clear across events", () => {
  test("event without cancelAtIso key keeps a prior value; explicit null clears it", async () => {
    const admin = adminFor(3009);

    // 1. create with cancelAt set — a Stripe cancel_at_period_end webhook.
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3009_create",
        providerCustomerId: "cus_3009",
        providerSubscriptionId: "sub_3009",
        cancelAtIso: "2026-07-01T00:00:00Z",
      }),
      admin,
    );
    let subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows[0]?.["cancelAt"]).toBe("2026-07-01T00:00:00Z");

    // 2. an unrelated update event that never mentions cancelAtIso (e.g. a
    // price/tier change) must NOT wipe the previously recorded cancelAt.
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3009_update",
        type: SubscriptionEventTypes.updated,
        providerCustomerId: "cus_3009",
        providerSubscriptionId: "sub_3009",
        tier: "business",
      }),
      admin,
    );
    subs = (await stack.http.queryOk("billing-foundation:query:subscription:list", {}, admin)) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(subs.rows[0]?.["tier"]).toBe("business");
    expect(subs.rows[0]?.["cancelAt"]).toBe("2026-07-01T00:00:00Z");

    // 3. reactivation — an update event with cancelAtIso explicitly null
    // clears it.
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3009_reactivate",
        type: SubscriptionEventTypes.updated,
        providerCustomerId: "cus_3009",
        providerSubscriptionId: "sub_3009",
        tier: "business",
        cancelAtIso: null,
      }),
      admin,
    );
    subs = (await stack.http.queryOk("billing-foundation:query:subscription:list", {}, admin)) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(subs.rows[0]?.["cancelAt"]).toBeNull();
  });
});

// scenario 9 (subscriptionTenantDestroyHook direct-call, default+HGB branches) removed:
// covered end-to-end by billing-foundation/__tests__/tenant-destroy.integration.test.ts,
// which drives the real tenant-lifecycle sweep instead of hand-feeding the hook.

describe("scenario 10: PII is encrypted at rest, not just erasable on destroy", () => {
  test("raw event-log payload and raw projection row both hold ciphertext, not the plaintext provider id", async () => {
    const admin = adminFor(3011);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3011_create",
        providerCustomerId: "cus_3011",
        providerSubscriptionId: "sub_3011",
      }),
      admin,
    );

    // Raw event-log row (kumiko_events) — archiveStream only stops REPLAY,
    // it never deletes rows, so if this were plaintext it would sit here
    // forever regardless of what a later tenant-destroy hook does.
    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    const createdPayload = esEvents[0]?.payload as
      | { providerCustomerId?: string; providerSubscriptionId?: string }
      | undefined;
    expect(createdPayload?.providerCustomerId).not.toBe("cus_3011");
    expect(createdPayload?.providerSubscriptionId).not.toBe("sub_3011");
    expect(isPiiCiphertext(createdPayload?.providerCustomerId)).toBe(true);
    expect(isPiiCiphertext(createdPayload?.providerSubscriptionId)).toBe(true);

    // Raw projection row — same story, decrypt-on-read (list-query,
    // get-subscription-for-tenant) is the only path that sees plaintext.
    const rawRows = await selectMany(db, subscriptionsProjectionTable, {
      id: subscriptionAggregateId(admin.tenantId),
    });
    expect(isPiiCiphertext(rawRows[0]?.["providerCustomerId"])).toBe(true);

    // But the decrypt-on-read query path still returns plaintext to callers.
    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows[0]?.["providerCustomerId"]).toBe("cus_3011");
  });

  test("crypto-shredding: erasing the tenant's subject key makes the event-log payload permanently unreadable (#800)", async () => {
    const admin = adminFor(3012);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      buildEvent({
        providerEventId: "evt_3012_create",
        providerCustomerId: "cus_3012",
        providerSubscriptionId: "sub_3012",
      }),
      admin,
    );
    const esEventsBefore = await loadAggregate(
      db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId,
    );
    const ciphertextBefore = (esEventsBefore[0]!.payload as { providerCustomerId?: string })
      .providerCustomerId as string;

    // This is exactly what tenant-lifecycle's "subject-keys" pipeline stage
    // (eraseSubjectKeys, stages.ts) does on tenant-destroy — same kms
    // instance, same subject shape, called directly instead of through the
    // full destroy pipeline so this test doesn't need to drive 8 stages.
    const kms = configuredPiiSubjectKms();
    if (!kms) throw new Error("expected a configured PII-subject KMS in this test stack");
    await kms.eraseKey(
      { kind: "tenant", tenantId: admin.tenantId },
      { requestId: "test:crypto-shred", eraseReason: "test" },
    );

    // The DEK is gone — the SAME ciphertext that decrypted cleanly a moment
    // ago now resolves to the erased sentinel, not the original value and
    // not a crash. That's the actual guarantee: not "redacted in the
    // read model" but "cryptographically impossible to recover", including
    // from the raw event-log row nothing in this feature ever deletes.
    const decrypted = await decryptPiiFieldValues(
      { providerCustomerId: ciphertextBefore },
      ["providerCustomerId"],
      kms,
      { requestId: "test:crypto-shred-verify" },
    );
    expect(decrypted["providerCustomerId"]).toBe(PII_ERASED_SENTINEL);
    expect(decrypted["providerCustomerId"]).not.toBe("cus_3012");
  });

  // No backfill job here on purpose: billing-foundation has never shipped
  // with a live subject KMS, so there is no pre-existing plaintext
  // subscription data anywhere to migrate — every row that will ever exist
  // is written through the encrypted path above. If that changes (billing-
  // foundation goes live before a KMS is configured somewhere), note for
  // whoever builds the backfill: the existing backfillEventPiiEncryption
  // (db/queries/backfill-pii.ts) does NOT cover this feature yet — its
  // lifecycle-event matcher expects `<aggregateType>.<verb>` event names,
  // but billing's are `billing-foundation:event:subscription-created`. The
  // custom-event catalog branch itself already resolves user/tenant/self
  // subjects — no framework gap to close here, only the
  // lifecycle-event matcher would need widening if this feature ever needs
  // a backfill.
});

// =============================================================================
// Scenario 11 — one-off payments: own aggregate, own
// read_payments-row, idempotent like process-event above.
// =============================================================================

function buildPaymentEventPayload(
  overrides: Partial<{
    providerEventId: string;
    providerCustomerId: string;
    priceId: string;
    providerCheckoutId: string;
  }> = {},
) {
  return {
    providerEventId: overrides.providerEventId ?? "evt_payment_default",
    providerName: "stripe",
    ...(overrides.providerCheckoutId !== undefined && {
      providerCheckoutId: overrides.providerCheckoutId,
    }),
    providerCustomerId: overrides.providerCustomerId ?? "cus_payment_default",
    priceId: overrides.priceId ?? "price_topup_test",
  };
}

describe("scenario 11: one-off payment — own aggregate, own read_payments-row", () => {
  test("first payment for tenant → read_payments-row created, duplicate=false", async () => {
    const admin = adminFor(4001);
    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processPaymentEvent,
      buildPaymentEventPayload({
        providerEventId: "evt_4001_payment",
        providerCustomerId: "cus_4001",
        priceId: "price_topup_test",
        providerCheckoutId: "cs_test_4001",
      }),
      admin,
    )) as Record<string, unknown>;

    expect(result["duplicate"]).toBe(false);
    expect(result["paymentAggregateId"]).toBe(paymentAggregateId(admin.tenantId));

    const rows = await selectMany<{ tenantId: string; priceId: string; providerName: string }>(
      db,
      paymentsProjectionTable,
      { tenantId: admin.tenantId },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.priceId).toBe("price_topup_test");
    expect(rows[0]?.providerName).toBe("stripe");

    const esEvents = await loadAggregate(db, paymentAggregateId(admin.tenantId), admin.tenantId);
    expect(esEvents[0]?.metadata.headers?.["providerCheckoutId"]).toBe("cs_test_4001");
  });

  test("idempotency: second call with same providerEventId → duplicate=true, no second row", async () => {
    const admin = adminFor(4002);

    const first = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processPaymentEvent,
      buildPaymentEventPayload({
        providerEventId: "evt_4002_retry",
        providerCustomerId: "cus_4002",
      }),
      admin,
    )) as Record<string, unknown>;
    expect(first["duplicate"]).toBe(false);

    const second = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processPaymentEvent,
      buildPaymentEventPayload({
        providerEventId: "evt_4002_retry",
        providerCustomerId: "cus_4002",
        priceId: "price_should_be_ignored",
      }),
      admin,
    )) as Record<string, unknown>;
    expect(second["duplicate"]).toBe(true);

    const rows = await selectMany(db, paymentsProjectionTable, { tenantId: admin.tenantId });
    expect(rows).toHaveLength(1); // dedup'd — no second row

    const esEvents = await loadAggregate(db, paymentAggregateId(admin.tenantId), admin.tenantId);
    expect(esEvents).toHaveLength(1);
  });

  test("second payment for the same tenant → second row (payments are facts, not state — no upsert)", async () => {
    const admin = adminFor(4003);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processPaymentEvent,
      buildPaymentEventPayload({
        providerEventId: "evt_4003_first",
        providerCustomerId: "cus_4003",
      }),
      admin,
    );
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processPaymentEvent,
      buildPaymentEventPayload({
        providerEventId: "evt_4003_second",
        providerCustomerId: "cus_4003",
      }),
      admin,
    );

    const rows = await selectMany(db, paymentsProjectionTable, { tenantId: admin.tenantId });
    expect(rows).toHaveLength(2);
  });

  test("idempotency anchor is tenant-scoped — same providerEventId for TWO tenants is NOT duplicate, each gets its own row", async () => {
    // Same shape as scenario 4's cross-tenant pin: two tenants can
    // legitimately see the same providerEventId (multiple Stripe accounts,
    // test/prod mix). paymentRowId includes tenantId in its key — without
    // that, the second INSERT would silently no-op (ON CONFLICT DO NOTHING)
    // against the first tenant's row instead of creating its own.
    const adminA = adminFor(4005);
    const adminB = adminFor(4006);
    const SHARED_EVT = "evt_shared_payment_id";

    const a = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processPaymentEvent,
      buildPaymentEventPayload({ providerEventId: SHARED_EVT, providerCustomerId: "cus_a_shared" }),
      adminA,
    )) as Record<string, unknown>;
    const b = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.processPaymentEvent,
      buildPaymentEventPayload({ providerEventId: SHARED_EVT, providerCustomerId: "cus_b_shared" }),
      adminB,
    )) as Record<string, unknown>;

    expect(a["duplicate"]).toBe(false);
    expect(b["duplicate"]).toBe(false);

    const rowsA = await selectMany(db, paymentsProjectionTable, { tenantId: adminA.tenantId });
    const rowsB = await selectMany(db, paymentsProjectionTable, { tenantId: adminB.tenantId });
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  });

  test("webhook-route payment-branch (createSubscriptionWebhookRoute): POST → row, retry POST → duplicate:true, still one row", async () => {
    const tenantId = testTenantId(4004);
    const body = JSON.stringify({
      providerEventId: "evt_webhook_payment_001",
      tenantId,
      providerCustomerId: "cus_webhook_4004",
      priceId: "price_webhook_test",
    });

    const first = await stack.app.request("/api/subscription/webhook/mock-payment", {
      method: "POST",
      body,
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody["processed"]).toBe(true);
    expect(firstBody["duplicate"]).toBe(false);

    const second = await stack.app.request("/api/subscription/webhook/mock-payment", {
      method: "POST",
      body,
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(secondBody["duplicate"]).toBe(true);

    const rows = await selectMany(db, paymentsProjectionTable, { tenantId });
    expect(rows).toHaveLength(1);
  });
});

// =============================================================================
// Opt-in guarantee: without `consumerProtection` no consent is required, none
// is recorded and the checkout behaves as before.
// =============================================================================

describe("consumerProtection off — checkout needs no consent and records none", () => {
  const CONSENT_EVENT_QN = "billing-foundation:event:checkout-consent-recorded";

  async function recordedConsentEvents(tenantId: string) {
    const streams = await Promise.all(
      [subscriptionAggregateId(tenantId), paymentAggregateId(tenantId)].map((aggregateId) =>
        loadAggregate(stack.db, aggregateId, tenantId as never, { includeArchived: true }),
      ),
    );
    return streams.flat().filter((e) => e.type === CONSENT_EVENT_QN);
  }

  test("create-checkout-session subscription and payment without consent succeed and write no consent event", async () => {
    mockCheckoutCalls.length = 0;
    const admin = adminFor(3090);
    const subscription = (await stack.http.writeOk(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock",
        priceId: "price_pro_test",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        mode: "subscription",
      },
      admin,
    )) as Record<string, unknown>;
    const payment = (await stack.http.writeOk(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock",
        priceId: "price_topup_test",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        mode: "payment",
      },
      admin,
    )) as Record<string, unknown>;

    expect(subscription["url"]).toBe("https://mock.example/checkout/price_pro_test");
    expect(payment["url"]).toBe("https://mock.example/checkout/price_topup_test");
    expect(mockCheckoutCalls).toHaveLength(2);
    expect(await recordedConsentEvents(admin.tenantId)).toEqual([]);
  });
});
