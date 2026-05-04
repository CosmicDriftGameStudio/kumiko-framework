// Integration-test: Mollie-Plugin → subscription-foundation → DB.
//
// Beweist die echte Verdrahtung — analog stripe-foundation.integration:
//   1. Mollie-webhook (form-urlencoded `id=tr_xxx`) kommt am
//      webhook-handler an
//   2. createSubscriptionMollieFeature (echter factory) verifiziert +
//      parsed via gemocktem MollieClientShape (= injection-port
//      `_clientShapeForTests` damit Mollie-SDK 4.5.0 keine HTTP-calls
//      macht; vi.mock ist im integration-guard-blocked)
//   3. Plugin returnt SubscriptionEvent → webhook-handler dispatched
//      zu process-event-handler
//   4. process-event-handler schreibt subscription + subscription-event
//      in die DB
//
// Drift-vector der ohne diesen Test fehlen würde: factory-Logik in
// createSubscriptionMollieFeature (drift-validation, plugin-registration,
// fetchAdapter-binding). Die plugin-methods sind separat in den
// Unit-Tests (verify-webhook.test.ts) abgedeckt, aber die Verdrahtung
// von factory bis foundation-DB-row beweist nur dieser Test.

import {
  createSubscriptionWebhookHandler,
  type SubscriptionProviderPlugin,
  subscriptionAggregateId,
  subscriptionFoundationFeature,
  subscriptionsProjectionTable,
} from "@kumiko/bundled-features/subscription-foundation";
import type { DbConnection } from "@kumiko/framework/db";
import type { TenantId } from "@kumiko/framework/engine";
import { createEventsTable, loadAggregate } from "@kumiko/framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@kumiko/framework/stack";
import type {
  Payment as MolliePayment,
  Subscription as MollieSubscription,
} from "@mollie/api-client";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createSubscriptionMollieFeature } from "../feature";
import type { MollieClientShape } from "../verify-webhook";

// =============================================================================
// Mock-MollieClient — replay-fähige in-memory state
//
// Der test-state ist module-level, wird aber per `beforeEach` reset —
// jeder Test sieht eine clean state. Der mock-client closured den state
// einmal beim factory-mount; reset() mutiert die Maps in-place damit
// die Closure-Referenzen aktuell bleiben.
// =============================================================================

type MollieMockState = {
  payments: Map<string, MolliePayment>;
  subscriptionsByCustomer: Map<string, MollieSubscription[]>;
  /** Tracked-create-calls für drift-pins. */
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
let webhookApp: Hono;

beforeAll(async () => {
  // Echte factory mit injection-port. Das beweist factory-Logik
  // (drift-validation, plugin-registration) im Test-pfad.
  const mollieFeature = createSubscriptionMollieFeature({
    apiKey: "test_dummy_apikey",
    webhookUrl: "https://test.example.com/api/subscription/webhook/mollie",
    priceToTier: PRICE_TO_TIER,
    priceToConfig: PRICE_TO_CONFIG,
    _clientShapeForTests: mollieMockClient,
  });

  stack = await setupTestStack({
    features: [subscriptionFoundationFeature, mollieFeature],
  });
  db = stack.db;
  // subscriptionsProjectionTable wird von setupTestStack automatisch
  // gepusht (r.projection mit `table`-Property → auto-push).
  await createEventsTable(db);

  webhookApp = new Hono();
  webhookApp.post(
    "/api/subscription/webhook/:providerName",
    createSubscriptionWebhookHandler({
      dispatchWrite: async ({ handlerQn, payload, tenantId }) => {
        const systemUser = createTestUser({
          id: 1,
          tenantId: tenantId as TenantId,
          roles: ["SystemAdmin"],
        });
        const res = await stack.http.write(handlerQn, payload, systemUser);
        const body = (await res.json()) as {
          isSuccess?: boolean;
          data?: unknown;
          error?: unknown;
        };
        return body.isSuccess
          ? { isSuccess: true, ...(body.data !== undefined && { data: body.data }) }
          : { isSuccess: false, ...(body.error !== undefined && { error: body.error }) };
      },
      resolveProvider: (providerName) => {
        const usage = stack.registry
          .getExtensionUsages("subscriptionProvider")
          .find((u) => u.entityName === providerName);
        // @cast-boundary engine-payload — extension-usage carries unknown options
        return usage?.options as SubscriptionProviderPlugin | undefined;
      },
    }),
  );
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
  // @cast-boundary mollie-sdk — minimal mock-shape, nur Felder die der Plugin liest
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
  // @cast-boundary mollie-sdk — minimal mock-shape, nur Felder die der Plugin liest
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
  return webhookApp.request("/api/subscription/webhook/mollie", {
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

    // 2. Existing sub jetzt im mock-state. Recurring-charge kommt:
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
      "subscription-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["providerName"]).toBe("mollie");
    expect(subs.rows[0]?.["providerSubscriptionId"]).toBe("sub_created_1");
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
    expect(esEvents[0]?.type).toBe("subscription-foundation:event:subscription-created");
    expect(esEvents[1]?.type).toBe("subscription-foundation:event:invoice-paid");
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
      "subscription-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["tier"]).toBe("business");
    expect(subs.rows[0]?.["status"]).toBe("active");
    // Drift-pin: providerSubscriptionId ist die VOM PLUGIN ERSTELLTE sub-id,
    // nicht der payment-id.
    expect(subs.rows[0]?.["providerSubscriptionId"]).toBe("sub_created_1");
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
  test("body ohne id → 401 (Plugin throws, foundation mapped auf signature_invalid)", async () => {
    const res = await webhookApp.request("/api/subscription/webhook/mollie", {
      method: "POST",
      body: "no-id-field",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("subscription_webhook_signature_invalid");
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
      "subscription-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(0);
  });

  test("provider not mounted → 404 (multi-provider-routing drift-pin)", async () => {
    // Drift-pin: nur "mollie" ist gemountet. Wenn jemand den webhook-
    // handler refactored sodass er ALLE requests an das erste plugin
    // routet, wäre dieser Test grün — bricht aber wenn der Test einen
    // unbekannten provider-name fordert.
    const res = await webhookApp.request("/api/subscription/webhook/paypal", {
      method: "POST",
      body: "id=tr_dummy",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("subscription_provider_not_registered");
  });
});
