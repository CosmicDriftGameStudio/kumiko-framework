// Integration test: Mollie plugin → subscription foundation → DB.
//
// Proves the real wiring, analogous to stripe-foundation.integration:
//   1. A Mollie webhook (form-urlencoded `id=tr_xxx`) reaches the
//      webhook handler.
//   2. createSubscriptionMollieFeature (the real factory) verifies and
//      parses it through a mocked MollieClientShape (= injection port
//      `_clientShapeForTests`, so Mollie SDK 4.5.0 makes no HTTP calls;
//      vi.mock is blocked by the integration guard).
//   3. The plugin returns a SubscriptionEvent, which the webhook handler
//      dispatches to the process-event handler.
//   4. The process-event handler writes the subscription and
//      subscription event to the DB.
//
// Without this test, factory logic in createSubscriptionMollieFeature
// could drift unnoticed (drift validation, plugin registration,
// fetchAdapter binding). The plugin methods are covered separately by
// unit tests (verify-webhook.test.ts), but only this test proves the
// wiring from the factory to the foundation DB row.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createBillingFoundationFeature,
  createSubscriptionWebhookRoute,
  subscriptionAggregateId,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type {
  Payment as MolliePayment,
  Subscription as MollieSubscription,
} from "@mollie/api-client";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createSubscriptionMollieFeature } from "../feature.ts";
import type { MollieClientShape } from "../verify-webhook.ts";

// =============================================================================
// Mock Mollie client — replayable in-memory state
//
// The test state is module-level but reset by `beforeEach`, so each test
// starts with clean state. The mock client captures the state once when
// the factory is mounted; reset() mutates the Maps in place so the closure
// references remain current.
// =============================================================================

type MollieMockState = {
  payments: Map<string, MolliePayment>;
  subscriptionsByCustomer: Map<string, MollieSubscription[]>;
  /** Tracked create calls used to detect drift. */
  createCallCount: number;
};

const mockState: MollieMockState = {
  payments: new Map(),
  subscriptionsByCustomer: new Map(),
  createCallCount: 0,
};

const mollieMockClient: MollieClientShape = {
  payments: {
    get: async (id: string) => {
      const payment = mockState.payments.get(id);
      if (!payment) throw new Error(`Mollie 404: payment ${id} not found`);
      return payment;
    },
  },
  customerSubscriptions: {
    get: async (subId: string, customerId: string) => {
      const subs = mockState.subscriptionsByCustomer.get(customerId) ?? [];
      const sub = subs.find((s) => s.id === subId);
      if (!sub) throw new Error(`Mollie 404: subscription ${subId} for ${customerId}`);
      return sub;
    },
    list: async (customerId: string) => {
      return mockState.subscriptionsByCustomer.get(customerId) ?? [];
    },
    create: async (customerId, params) => {
      mockState.createCallCount += 1;
      const newSub = buildMockSubscription({
        id: `sub_created_${mockState.createCallCount}`,
        customerId,
        status: "active",
        metadata: params.metadata,
      });
      const existing = mockState.subscriptionsByCustomer.get(customerId) ?? [];
      mockState.subscriptionsByCustomer.set(customerId, [...existing, newSub]);
      return newSub;
    },
  },
};

const PRICE_TO_TIER = { plan_pro: "pro", plan_business: "business" };
const PRICE_TO_CONFIG = {
  plan_pro: {
    amountValue: "9.99",
    amountCurrency: "EUR",
    interval: "1 month",
    description: "Pro Monthly",
  },
  plan_business: {
    amountValue: "29.99",
    amountCurrency: "EUR",
    interval: "1 month",
    description: "Business Monthly",
  },
};

// =============================================================================
// Setup
// =============================================================================

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  // Real factory with an injection port. This exercises factory logic
  // (drift validation, plugin registration) through the test path.
  const mollieFeature = createSubscriptionMollieFeature({
    apiKey: "test_dummy_apikey",
    webhookUrl: "https://test.example.com/api/subscription/webhook/mollie",
    priceToTier: PRICE_TO_TIER,
    priceToConfig: PRICE_TO_CONFIG,
    _clientShapeForTests: mollieMockClient,
  });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature(),
      mollieFeature,
    ],
    extraRoutes: [createSubscriptionWebhookRoute()],
  });
  db = stack.db;
  // subscriptionsProjectionTable is pushed automatically by setupTestStack
  // (an r.projection with a `table` property is auto-pushed).
  await unsafeCreateEntityTable(db, tenantEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  mockState.payments.clear();
  mockState.subscriptionsByCustomer.clear();
  mockState.createCallCount = 0;
});

// =============================================================================
// Fixtures
// =============================================================================

function buildMockPayment(overrides: Partial<Record<string, unknown>> = {}): MolliePayment {
  // @cast-boundary mollie-sdk — minimal mock shape containing only the fields read by the plugin
  return {
    id: "tr_test_001",
    customerId: "cst_test_001",
    subscriptionId: "sub_test_001",
    sequenceType: "first",
    status: "paid",
    metadata: {},
    ...overrides,
  } as MolliePayment;
}

function buildMockSubscription(
  overrides: Partial<Record<string, unknown>> = {},
): MollieSubscription {
  // @cast-boundary mollie-sdk — minimal mock shape containing only the fields read by the plugin
  return {
    id: "sub_test_001",
    customerId: "cst_test_001",
    status: "active",
    nextPaymentDate: "2026-12-01",
    startDate: "2026-05-01",
    metadata: {},
    ...overrides,
  } as MollieSubscription;
}

async function postMollieWebhook(id: string) {
  return stack.app.request("/api/subscription/webhook/mollie", {
    method: "POST",
    body: `id=${id}`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

// =============================================================================
// Scenarios
// =============================================================================

describe("scenario 1: Mollie-event → DB happy path", () => {
  test("recurring-payment paid → fetch sub → invoicePaid event → DB-row geupdated", async () => {
    const tenantStringId = testTenantId(5001);

    // 1. First mandate-setup-payment (= subscription-created event).
    //    Real-world: Mollie sendet first-payment-paid → Plugin
    //    erstellt sub on-the-fly → Created-event landed in DB.
    mockState.payments.set(
      "tr_5001_first",
      buildMockPayment({
        id: "tr_5001_first",
        customerId: "cst_5001",
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: { tenantId: tenantStringId, priceId: "plan_pro" },
      }),
    );
    await postMollieWebhook("tr_5001_first");

    // 2. The existing subscription is now in the mock state. A recurring charge arrives:
    mockState.payments.set(
      "tr_5001_renewal",
      buildMockPayment({
        id: "tr_5001_renewal",
        customerId: "cst_5001",
        subscriptionId: "sub_created_1",
        sequenceType: "recurring",
        status: "paid",
      }),
    );

    const res = await postMollieWebhook("tr_5001_renewal");
    expect(res.status).toBe(200);

    const admin = createTestUser({
      id: 5001,
      tenantId: tenantStringId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["providerName"]).toBe("mollie");
    // Looser assertion: does not depend on the mock implementation detail (=
    // "sub_created_${count}"). Important: subscriptionId is set BY THE PLUGIN (not the payment ID),
    // not null.
    expect(subs.rows[0]?.["providerSubscriptionId"]).toMatch(/^sub_/);
    expect(subs.rows[0]?.["tier"]).toBe("pro");
    expect(subs.rows[0]?.["status"]).toBe("active");
    expect(subs.rows[0]?.["id"]).toBe(subscriptionAggregateId(tenantStringId));

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(tenantStringId),
      tenantStringId,
    );
    // create + renewal beide im stream
    expect(esEvents).toHaveLength(2);
    expect(esEvents[0]?.type).toBe("billing-foundation:event:subscription-created");
    expect(esEvents[1]?.type).toBe("billing-foundation:event:invoice-paid");
    expect(esEvents[1]?.metadata.headers?.["providerEventId"]).toBe("tr_5001_renewal");
  });
});

describe("scenario 2: mandate-setup-flow — first-payment-paid OHNE existing sub → Plugin erstellt sub on-the-fly", () => {
  test("Plugin ruft customerSubscriptions.create + emit Created-Event → subscription-row in DB", async () => {
    const tenantStringId = testTenantId(5002);

    mockState.payments.set(
      "tr_5002_first",
      buildMockPayment({
        id: "tr_5002_first",
        customerId: "cst_5002",
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: { tenantId: tenantStringId, priceId: "plan_business" },
      }),
    );

    const res = await postMollieWebhook("tr_5002_first");
    expect(res.status).toBe(200);

    expect(mockState.createCallCount).toBe(1);

    const admin = createTestUser({
      id: 5002,
      tenantId: tenantStringId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["tier"]).toBe("business");
    expect(subs.rows[0]?.["status"]).toBe("active");
    // Drift pin: providerSubscriptionId is the subscription ID CREATED BY THE PLUGIN, not the
    // payment ID. Looser assertion: does not depend on the mock implementation detail (=
    // "sub_created_${count}"). Important: subscriptionId is set BY THE PLUGIN (not the payment ID),
    // not null.
    expect(subs.rows[0]?.["providerSubscriptionId"]).toMatch(/^sub_/);
  });
});

describe("scenario 3: idempotency via Mollie-retry", () => {
  test("derselbe tr_xxx 2× → 2. Mal foundation duplicate=true, kein zweiter event-row, kein zweiter sub-create", async () => {
    const tenantStringId = testTenantId(5003);

    mockState.payments.set(
      "tr_5003_retry",
      buildMockPayment({
        id: "tr_5003_retry",
        customerId: "cst_5003",
        subscriptionId: null,
        sequenceType: "first",
        status: "paid",
        metadata: { tenantId: tenantStringId, priceId: "plan_pro" },
      }),
    );

    const res1 = await postMollieWebhook("tr_5003_retry");
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { processed?: boolean; duplicate?: boolean };
    expect(body1.duplicate).toBe(false);

    const res2 = await postMollieWebhook("tr_5003_retry");
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { duplicate?: boolean };
    expect(body2.duplicate).toBe(true);

    // Drift-pin: ensureSubscriptionForMandate fand die existing sub via list.
    expect(mockState.createCallCount).toBe(1);

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(tenantStringId),
      tenantStringId,
    );
    expect(esEvents).toHaveLength(1);
  });
});

describe("scenario 4: error + ignored paths", () => {
  test("body ohne id → 401 (Plugin throws, extraRoute mapped auf extra_route_signature_invalid)", async () => {
    const res = await stack.app.request("/api/subscription/webhook/mollie", {
      method: "POST",
      body: "no-id-field",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("extra_route_signature_invalid");
  });

  test("sub_xxx-direct-event → 200 ignored, kein DB-write", async () => {
    const tenantStringId = testTenantId(5004);
    const res = await postMollieWebhook("sub_5004_direct");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored?: boolean };
    expect(body.ignored).toBe(true);

    const admin = createTestUser({
      id: 5004,
      tenantId: tenantStringId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(0);
  });

  test("provider not mounted → 404 (multi-provider-routing drift-pin)", async () => {
    // Drift pin: only "mollie" is mounted. If the webhook handler were
    // refactored to route ALL requests to the first plugin, this test would
    // pass; it must fail when the request names an unknown provider.
    const res = await stack.app.request("/api/subscription/webhook/paypal", {
      method: "POST",
      body: "id=tr_dummy",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("subscription_provider_not_registered");
  });
});
