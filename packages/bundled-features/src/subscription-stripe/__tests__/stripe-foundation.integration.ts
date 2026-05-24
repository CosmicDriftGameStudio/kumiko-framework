// Integration-test: Stripe-Plugin → subscription-foundation → DB.
//
// Beweist die echte Verdrahtung:
//   1. Stripe-event mit valider Signatur kommt am webhook-handler an
//   2. Stripe-Plugin verifiziert + parsed → SubscriptionEvent
//   3. webhook-handler dispatched zu process-event-handler
//   4. process-event-handler schreibt subscription + subscription-event
//      in die DB
//
// Type-checks fangen struct-mismatch, NICHT runtime-mismatches (Zod-
// validation des process-event-schema könnte stricter sein als der
// Stripe-output liefert). Dieser Test fängt das Spalten-Mapping +
// Verdrahtungs-Bugs ab.

import {
  billingFoundationFeature,
  createSubscriptionWebhookHandler,
  type SubscriptionProviderPlugin,
  subscriptionAggregateId,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { Hono } from "hono";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSubscriptionStripeFeature } from "../feature";

// =============================================================================
// Setup
// =============================================================================

const TEST_SECRET = "whsec_test_integration_secret";
const TEST_API_KEY = "sk_test_integration_apikey";
const PRICE_TO_TIER = { price_pro_monthly: "pro", price_business_yearly: "business" };

let stack: TestStack;
let db: DbConnection;
let webhookApp: Hono;

const stripeForFixtures = new Stripe(TEST_API_KEY, { apiVersion: "2026-04-22.dahlia" });

beforeAll(async () => {
  const stripeFeature = createSubscriptionStripeFeature({
    webhookSecret: TEST_SECRET,
    apiKey: TEST_API_KEY,
    priceToTier: PRICE_TO_TIER,
  });

  stack = await setupTestStack({
    features: [billingFoundationFeature, stripeFeature],
  });
  db = stack.db;
  // subscriptionsProjectionTable wird von setupTestStack automatisch
  // gepusht (r.projection mit `table`-Property → auto-push).
  await createEventsTable(db);

  // Webhook-app: Hono mit der webhook-handler-Route.
  // dispatchWrite ruft `stack.http.write` mit dem System-User des
  // resolved-Tenants — das ist exakt was der App-Builder im echten
  // bin/server.ts via extraRoutes wireup macht.
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
        const body = await res.json();
        return body.isSuccess
          ? { isSuccess: true, data: body.data }
          : { isSuccess: false, error: body.error };
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

function buildStripeSubscriptionEvent(overrides: {
  eventId?: string;
  tenantId?: string;
  priceId?: string;
  status?: string;
  customerId?: string;
  subscriptionId?: string;
  eventType?: string;
}) {
  const eventId = overrides.eventId ?? "evt_integration_001";
  return {
    id: eventId,
    object: "event",
    api_version: "2026-04-22.dahlia",
    created: 1_770_000_000,
    type: overrides.eventType ?? "customer.subscription.created",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: overrides.subscriptionId ?? "sub_integration_001",
        object: "subscription",
        customer: overrides.customerId ?? "cus_integration_001",
        status: overrides.status ?? "active",
        metadata: { tenantId: overrides.tenantId ?? "tenant-int-1" },
        items: {
          object: "list",
          data: [
            {
              id: "si_int",
              object: "subscription_item",
              current_period_end: 1_780_000_000,
              price: { id: overrides.priceId ?? "price_pro_monthly", object: "price" },
            },
          ],
          has_more: false,
        },
      },
    },
  };
}

function signEvent(payload: string): string {
  return stripeForFixtures.webhooks.generateTestHeaderString({
    payload,
    secret: TEST_SECRET,
  });
}

async function postStripeWebhook(payload: string, sig: string) {
  return webhookApp.request("/api/subscription/webhook/stripe", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": sig, "content-type": "application/json" },
  });
}

// =============================================================================
// Scenarios
// =============================================================================

describe("scenario 1: Stripe-event → DB happy path", () => {
  test("valid sig + bekannter event-type → subscription-row + subscription-event-row in DB", async () => {
    const tenantStringId = testTenantId(4001);
    const stripeEvent = buildStripeSubscriptionEvent({
      eventId: "evt_4001_create",
      tenantId: tenantStringId,
      subscriptionId: "sub_4001",
      customerId: "cus_4001",
      priceId: "price_business_yearly",
    });
    const payload = JSON.stringify(stripeEvent);
    const sig = signEvent(payload);

    const res = await postStripeWebhook(payload, sig);
    expect(res.status).toBe(200);

    // Prüfe DB-state: subscription-row + subscription-event-row für
    // diesen Tenant.
    const admin = createTestUser({
      id: 4001,
      tenantId: tenantStringId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["providerName"]).toBe("stripe");
    expect(subs.rows[0]?.["providerSubscriptionId"]).toBe("sub_4001");
    expect(subs.rows[0]?.["providerCustomerId"]).toBe("cus_4001");
    expect(subs.rows[0]?.["tier"]).toBe("business");
    expect(subs.rows[0]?.["status"]).toBe("active");
    // Drift-pin: deterministic aggregate-id matched zwischen Stripe-Plugin
    // (foundation-side) und expected uuid.
    expect(subs.rows[0]?.["id"]).toBe(subscriptionAggregateId(tenantStringId));

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(tenantStringId),
      tenantStringId,
    );
    expect(esEvents).toHaveLength(1);
    expect(esEvents[0]?.type).toBe("billing-foundation:event:subscription-created");
    expect(esEvents[0]?.metadata.headers?.["providerName"]).toBe("stripe");
    expect(esEvents[0]?.metadata.headers?.["providerEventId"]).toBe("evt_4001_create");
    // rawPayload wurde 1:1 in headers archiviert
    const rawHeader = esEvents[0]?.metadata.headers?.["rawPayload"] as string;
    const archivedRaw = JSON.parse(rawHeader) as { id: string };
    expect(archivedRaw.id).toBe("evt_4001_create");
  });
});

describe("scenario 2: invalid sig → 401, kein DB-write", () => {
  test("wrong webhook-secret → 401, foundation sieht keinen event", async () => {
    const tenantStringId = testTenantId(4002);
    const stripeEvent = buildStripeSubscriptionEvent({
      eventId: "evt_4002_bad",
      tenantId: tenantStringId,
      subscriptionId: "sub_4002",
    });
    const payload = JSON.stringify(stripeEvent);
    // Wrong secret = invalid sig.
    const wrongSig = stripeForFixtures.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_wrong_secret",
    });

    const res = await postStripeWebhook(payload, wrongSig);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("subscription_webhook_signature_invalid");

    // Drift-pin: foundation-DB ist unberührt — kein subscription-row
    // für diesen Tenant entstanden.
    const admin = createTestUser({
      id: 4002,
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
});

describe("scenario 3: idempotency via Stripe-retry", () => {
  test("derselbe Stripe-event 2× → 2. Mal foundation duplicate=true, kein zweiter event-row", async () => {
    const tenantStringId = testTenantId(4003);
    const stripeEvent = buildStripeSubscriptionEvent({
      eventId: "evt_4003_retry",
      tenantId: tenantStringId,
      subscriptionId: "sub_4003",
    });
    const payload = JSON.stringify(stripeEvent);
    const sig = signEvent(payload);

    const res1 = await postStripeWebhook(payload, sig);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { processed: boolean; duplicate: boolean };
    expect(body1.duplicate).toBe(false);

    // Stripe retry-storm — selber event mit selber providerEventId
    const res2 = await postStripeWebhook(payload, sig);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { processed: boolean; duplicate: boolean };
    expect(body2.duplicate).toBe(true);

    // Drift-pin: nur ein event im subscription-stream
    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(tenantStringId),
      tenantStringId,
    );
    expect(esEvents).toHaveLength(1);
  });
});

describe("scenario 4: ignored event-types pass through", () => {
  test("customer.created → 200 ignored, kein dispatch", async () => {
    const tenantStringId = testTenantId(4004);
    const stripeEvent = buildStripeSubscriptionEvent({
      eventId: "evt_4004_ignored",
      eventType: "customer.created",
      tenantId: tenantStringId,
    });
    const payload = JSON.stringify(stripeEvent);
    const sig = signEvent(payload);

    const res = await postStripeWebhook(payload, sig);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored?: boolean; processed?: boolean };
    expect(body.ignored).toBe(true);
    expect(body.processed).toBeUndefined();

    const admin = createTestUser({
      id: 4004,
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
});
