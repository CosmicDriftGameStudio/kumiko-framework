// Integration-test: Mollie-Plugin → subscription-foundation → DB.
//
// Beweist die echte Verdrahtung — analog stripe-foundation.integration:
//   1. Mollie-webhook (form-urlencoded `id=tr_xxx`) kommt am
//      webhook-handler an
//   2. Plugin fetcht payment + subscription via Mollie-API (gemockt
//      über injected MollieClientShape — Mollie-SDK 4.5.0 hat keinen
//      generateTestHeaderString-equivalent)
//   3. Plugin returnt SubscriptionEvent → webhook-handler dispatched
//      zu process-event-handler
//   4. process-event-handler schreibt subscription + subscription-event
//      in die DB
//
// **Test-feature statt createSubscriptionMollieFeature:** der factory
// baut intern einen real createMollieClient(apiKey) der HTTP-calls
// macht. Wir können nicht via vi.mock injizieren (integration-guard
// blockiert vi.fn/vi.mock/vi.spyOn). Stattdessen baut der test ein
// minimal-feature das die echten plugin-methods (`verifyAndParse-
// MollieWebhook` + `createMollieCheckoutSession`) nutzt mit einem
// hand-mock-MollieClient als injection. createSubscriptionMollie-
// Feature's factory-Logik ist von den Unit-Tests in feature.test.ts
// abgedeckt.

import {
  createSubscriptionWebhookHandler,
  type SubscriptionProviderPlugin,
  subscriptionAggregateId,
  subscriptionEntity,
  subscriptionEventEntity,
  subscriptionFoundationFeature,
} from "@kumiko/bundled-features/subscription-foundation";
import type { DbConnection } from "@kumiko/framework/db";
import { defineFeature, type TenantId } from "@kumiko/framework/engine";
import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
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
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type MollieClientShape, verifyAndParseMollieWebhook } from "../verify-webhook";

// =============================================================================
// Mock-MollieClient — replay-fähige in-memory state
//
// Dieselben Methoden die `verifyAndParseMollieWebhook` aufruft.
// State per Test isoliert (clear() vor jedem scenario im describe-block).
// =============================================================================

type MollieMockState = {
  payments: Map<string, MolliePayment>;
  subscriptionsByCustomer: Map<string, MollieSubscription[]>;
  /** Tracked-create-calls für drift-pins (= "Plugin hat exactly N mal
   *  customerSubscriptions.create gerufen"). */
  createCallCount: number;
};

const mockState: MollieMockState = {
  payments: new Map(),
  subscriptionsByCustomer: new Map(),
  createCallCount: 0,
};

function resetMockState(): void {
  mockState.payments.clear();
  mockState.subscriptionsByCustomer.clear();
  mockState.createCallCount = 0;
}

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
      const newSub: MollieSubscription = buildMockSubscription({
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
// Test-feature: nutzt die echten plugin-methods mit gemocktem Mollie-
// Client. Registriert plugin unter "subscriptionProvider"/"mollie" so
// dass der webhook-handler ihn via path-segment findet.
// =============================================================================

const verifyAndParse = verifyAndParseMollieWebhook(mollieMockClient, {
  priceToTier: PRICE_TO_TIER,
  priceToConfig: PRICE_TO_CONFIG,
});

const testMollieFeature = defineFeature("test-mollie-plugin", (r) => {
  r.requires("subscription-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: verifyAndParse,
    // createCheckoutSession + createPortalSession nicht — der echte
    // Mollie-Plugin (createSubscriptionMollieFeature) registriert sie
    // optional, foundation behandelt fehlende methods korrekt.
  };
  r.useExtension("subscriptionProvider", "mollie", plugin);
});

// =============================================================================
// Setup
// =============================================================================

let stack: TestStack;
let db: DbConnection;
let webhookApp: Hono;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [subscriptionFoundationFeature, testMollieFeature],
  });
  db = stack.db;
  await createEntityTable(db, subscriptionEntity);
  await createEntityTable(db, subscriptionEventEntity);
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
        return usage?.options as SubscriptionProviderPlugin | undefined;
      },
    }),
  );
});

afterAll(async () => {
  await stack.cleanup();
});

// =============================================================================
// Fixtures
// =============================================================================

function buildMockPayment(overrides: Partial<Record<string, unknown>> = {}): MolliePayment {
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
    resetMockState();
    const tenantStringId = testTenantId(5001);

    // Erst: existing subscription (= Tenant ist bereits Pro). Mollie
    // sendet bei recurring-charges einen tr_xxx-event mit
    // sequenceType=recurring + filled subscriptionId.
    const sub = buildMockSubscription({
      id: "sub_5001",
      customerId: "cst_5001",
      status: "active",
      metadata: { tenantId: tenantStringId, priceId: "plan_pro" },
    });
    mockState.subscriptionsByCustomer.set("cst_5001", [sub]);
    mockState.payments.set(
      "tr_5001_renewal",
      buildMockPayment({
        id: "tr_5001_renewal",
        customerId: "cst_5001",
        subscriptionId: "sub_5001",
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
    expect(subs.rows[0]?.["providerSubscriptionId"]).toBe("sub_5001");
    expect(subs.rows[0]?.["tier"]).toBe("pro");
    expect(subs.rows[0]?.["status"]).toBe("active");
    expect(subs.rows[0]?.["id"]).toBe(subscriptionAggregateId(tenantStringId));

    const events = (await stack.http.queryOk(
      "subscription-foundation:query:subscription-event:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.["providerEventId"]).toBe("tr_5001_renewal");
    expect(events.rows[0]?.["eventType"]).toBe("invoice.paid");
  });
});

describe("scenario 2: mandate-setup-flow — first-payment-paid OHNE existing sub → Plugin erstellt sub on-the-fly", () => {
  test("Plugin ruft customerSubscriptions.create + emit Created-Event → subscription-row in DB", async () => {
    resetMockState();
    const tenantStringId = testTenantId(5002);

    // Mollie's classic mandate-setup: payment.subscriptionId=null,
    // sequenceType=first, status=paid, metadata trägt tenantId+priceId.
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
    // listResolve ist leer → Plugin's ensureSubscriptionForMandate ruft create.

    const res = await postMollieWebhook("tr_5002_first");
    expect(res.status).toBe(200);

    // Drift-pin: Plugin hat customerSubscriptions.create EXACTLY EINMAL gerufen.
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
    // nicht der payment-id. Wenn jemand die Werte vertauschen würde,
    // bricht das hier loud.
    expect(subs.rows[0]?.["providerSubscriptionId"]).toBe("sub_created_1");
  });
});

describe("scenario 3: idempotency via Mollie-retry", () => {
  test("derselbe tr_xxx 2× → 2. Mal foundation duplicate=true, kein zweiter event-row, kein zweiter sub-create", async () => {
    resetMockState();
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

    // Mollie retry-storm — selber tr_xxx
    const res2 = await postMollieWebhook("tr_5003_retry");
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { duplicate?: boolean };
    expect(body2.duplicate).toBe(true);

    // Drift-pin: Plugin hat customerSubscriptions.create NUR EINMAL gerufen
    // (= ensureSubscriptionForMandate fand die existing sub via list-check).
    expect(mockState.createCallCount).toBe(1);

    const admin = createTestUser({
      id: 5003,
      tenantId: tenantStringId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const events = (await stack.http.queryOk(
      "subscription-foundation:query:subscription-event:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(events.rows).toHaveLength(1);
  });
});

describe("scenario 4: ignored / unknown ID-forms pass through", () => {
  test("body ohne id → 401 (Plugin throws, foundation mapped auf signature_invalid)", async () => {
    resetMockState();
    const res = await webhookApp.request("/api/subscription/webhook/mollie", {
      method: "POST",
      body: "no-id-field",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    // Plugin throws bei body ohne id; webhook-handler mapped throws auf 401.
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("subscription_webhook_signature_invalid");
  });

  test("sub_xxx-direct-event → 200 ignored, kein DB-write", async () => {
    resetMockState();
    const tenantStringId = testTenantId(5004);
    // sub_xxx-events sind heute NICHT supported (= Plugin returnt null,
    // foundation 200 ignored).
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
});
