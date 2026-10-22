// Integration test: Stripe plugin → subscription foundation → database.
//
// Verifies the real wiring:
//   1. A Stripe event with a valid signature reaches the webhook handler.
//   2. The Stripe plugin verifies and parses it into a SubscriptionEvent.
//   3. The webhook handler dispatches it to the process-event handler.
//   4. The process-event handler writes the subscription and subscription event
//      to the database.
//
// Type checks catch structural mismatches, not runtime mismatches (the Zod
// validation in the process-event schema could be stricter than the Stripe
// output). This test catches column-mapping and wiring bugs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createBillingFoundationFeature,
  createSubscriptionWebhookRoute,
  subscriptionAggregateId,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import Stripe from "stripe";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { configValuesTable, createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createSubscriptionStripeFeature } from "../feature.ts";

// Qualified names of the runtime keys (drift pin: they must exactly match
// the names qualified by r.config(...) in the feature build — `subscription-stripe:
// config:<shortName>`, backing:"secrets"). Scenario 5 sets them via
// config:write:set and verifies resolution through the webhook.
const API_KEY_CONFIG_QN = "subscription-stripe:config:api-key";
const WEBHOOK_SECRET_CONFIG_QN = "subscription-stripe:config:webhook-secret";

// =============================================================================
// Setup
// =============================================================================

const TEST_SECRET = "whsec_test_integration_secret";
const TEST_API_KEY = "sk_test_integration_apikey";
const PRICE_TO_TIER = { price_pro_monthly: "pro", price_business_yearly: "business" };

let stack: TestStack;
let db: DbConnection;

const stripeForFixtures = new Stripe(TEST_API_KEY);

beforeAll(async () => {
  // subscription-stripe now requires config and secrets. Scenarios 1–4 use
  // the factory fallback (no system secret is seeded and no systemSecrets are
  // wired), so resolution falls back to the option keys.
  const stripeFeature = createSubscriptionStripeFeature({
    webhookSecret: TEST_SECRET,
    apiKey: TEST_API_KEY,
    priceToTier: PRICE_TO_TIER,
  });

  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature(),
      stripeFeature,
    ],
    masterKeyProvider,
    extraContext: ({ db: ctxDb, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      // Forwarded to every signature extraRoute's verify()/handler() as
      // `deps.secrets` — one webhook route now serves both the factory-
      // fallback scenarios (1–4, no row seeded yet) and the runtime-secret
      // scenario (5, seeded via config:write:set) since runtime.ts's
      // resolver already falls back to the factory options when the store
      // is empty.
      secrets: createSecretsContext({ db: ctxDb, masterKeyProvider, registry: registry }),
    }),
    extraRoutes: [createSubscriptionWebhookRoute()],
  });
  db = stack.db;
  // subscriptionsProjectionTable is pushed automatically by setupTestStack
  // (r.projection with a `table` property triggers auto-push). config and
  // secrets require their tables explicitly.
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafePushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
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
  consentId?: string;
  created?: number;
}) {
  const eventId = overrides.eventId ?? "evt_integration_001";
  return {
    id: eventId,
    object: "event",
    api_version: "2026-04-22.dahlia",
    created: overrides.created ?? 1_770_000_000,
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
        metadata: {
          tenantId: overrides.tenantId ?? "tenant-int-1",
          ...(overrides.consentId !== undefined && { consentId: overrides.consentId }),
        },
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

async function signEvent(payload: string, secret = TEST_SECRET): Promise<string> {
  return stripeForFixtures.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
  });
}

async function postStripeWebhook(payload: string, sig: string) {
  return stack.app.request("/api/subscription/webhook/stripe", {
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
    const sig = await signEvent(payload);

    const res = await postStripeWebhook(payload, sig);
    expect(res.status).toBe(200);

    // Verify the database state: a subscription row and subscription-event row
    // for this tenant.
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
    // Drift pin: the deterministic aggregate ID must match between the Stripe
    // plugin (foundation side) and the expected UUID.
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
    expect(Object.keys(esEvents[0]?.metadata.headers ?? {}).sort()).toEqual([
      "providerEventId",
      "providerName",
    ]);
  });
});

describe("scenario 1a: provider PII never reaches the event store", () => {
  const customerPii = {
    email: "pii.person@example.test",
    name: "Pia Personenbezug",
    phone: "+49 170 5550199",
    address: { line1: "Datenschutzweg 7", city: "Privatstadt", postal_code: "99999" },
  };

  test("event carrying customer_details + custom_fields is stored without rawPayload or those values", async () => {
    const tenantStringId = testTenantId(4150);
    const base = buildStripeSubscriptionEvent({
      eventId: "evt_4150_pii",
      tenantId: tenantStringId,
      subscriptionId: "sub_4150",
      customerId: "cus_4150",
    });
    const stripeEvent = {
      ...base,
      data: {
        object: {
          ...base.data.object,
          customer_details: customerPii,
          custom_fields: [{ key: "vat", text: { value: "DE123456789" } }],
        },
      },
    };
    const payload = JSON.stringify(stripeEvent);

    const res = await postStripeWebhook(payload, await signEvent(payload));
    expect(res.status).toBe(200);

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(tenantStringId),
      tenantStringId,
    );
    expect(esEvents).toHaveLength(1);
    expect(esEvents[0]?.metadata.headers?.["providerEventId"]).toBe("evt_4150_pii");
    expect(esEvents[0]?.metadata.headers).not.toHaveProperty("rawPayload");
    expect(esEvents[0]?.payload).not.toHaveProperty("rawPayload");

    const stored = JSON.stringify({
      headers: esEvents[0]?.metadata.headers,
      payload: esEvents[0]?.payload,
    });
    for (const secret of [
      customerPii.email,
      customerPii.name,
      customerPii.phone,
      customerPii.address.line1,
      "DE123456789",
    ]) {
      expect(stored).not.toContain(secret);
    }
  });
});

describe("scenario 1b: consentId from webhook metadata is persisted", () => {
  test("metadata.consentId lands in the appended subscription event payload", async () => {
    const tenantStringId = testTenantId(4101);
    const payload = JSON.stringify(
      buildStripeSubscriptionEvent({
        eventId: "evt_4101_consent",
        tenantId: tenantStringId,
        subscriptionId: "sub_4101",
        customerId: "cus_4101",
        consentId: "consent-4101",
      }),
    );

    const res = await postStripeWebhook(payload, await signEvent(payload));
    expect(res.status).toBe(200);

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(tenantStringId),
      tenantStringId,
    );
    expect(esEvents).toHaveLength(1);
    expect(esEvents[0]?.payload).toMatchObject({ consentId: "consent-4101" });
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
    const wrongSig = await signEvent(payload, "whsec_wrong_secret");

    const res = await postStripeWebhook(payload, wrongSig);
    expect(res.status).toBe(401);
    // extraRoutes' generic signature-rejection code
    // — verify() throws a plain Error on sig mismatch, buildServer maps any
    // non-ExtraRouteRejection throw from verify() to this code.
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("extra_route_signature_invalid");

    // Drift pin: the foundation database remains untouched; no subscription row
    // was created for this tenant.
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
    const sig = await signEvent(payload);

    const res1 = await postStripeWebhook(payload, sig);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { processed: boolean; duplicate: boolean };
    expect(body1.duplicate).toBe(false);

    // Stripe retry storm: the same event with the same providerEventId
    const res2 = await postStripeWebhook(payload, sig);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { processed: boolean; duplicate: boolean };
    expect(body2.duplicate).toBe(true);

    // Drift pin: only one event exists in the subscription stream
    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(tenantStringId),
      tenantStringId,
    );
    expect(esEvents).toHaveLength(1);
  });
});

describe("scenario 3b: late delivery of an older Stripe event", () => {
  test("an older subscription.updated delivered after the cancellation does not reactivate the subscription", async () => {
    const tenantStringId = testTenantId(4013);
    const base = { tenantId: tenantStringId, subscriptionId: "sub_4013", customerId: "cus_4013" };
    const deliver = async (event: ReturnType<typeof buildStripeSubscriptionEvent>) => {
      const payload = JSON.stringify(event);
      const res = await postStripeWebhook(payload, await signEvent(payload));
      expect(res.status).toBe(200);
    };

    await deliver(
      buildStripeSubscriptionEvent({ ...base, eventId: "evt_4013_create", created: 1_770_000_100 }),
    );
    await deliver(
      buildStripeSubscriptionEvent({
        ...base,
        eventId: "evt_4013_deleted",
        eventType: "customer.subscription.deleted",
        status: "canceled",
        created: 1_770_000_300,
      }),
    );
    // Stripe does not guarantee delivery order; this update was emitted before the cancellation.
    await deliver(
      buildStripeSubscriptionEvent({
        ...base,
        eventId: "evt_4013_updated_late",
        eventType: "customer.subscription.updated",
        status: "active",
        priceId: "price_business_yearly",
        created: 1_770_000_200,
      }),
    );

    const admin = createTestUser({
      id: 4013,
      tenantId: tenantStringId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["status"]).toBe("canceled");
    expect(subs.rows[0]?.["tier"]).toBe("pro");
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
    const sig = await signEvent(payload);

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

describe("scenario 4b: customer.subscription.updated with a new price re-syncs the tier", () => {
  test("same subscription, price changes pro → business → projection tier follows", async () => {
    const tenantStringId = testTenantId(4008);
    const created = buildStripeSubscriptionEvent({
      eventId: "evt_4008_create",
      tenantId: tenantStringId,
      subscriptionId: "sub_4008",
      customerId: "cus_4008",
      priceId: "price_pro_monthly",
    });
    const createdSig = await signEvent(JSON.stringify(created));
    const createdRes = await postStripeWebhook(JSON.stringify(created), createdSig);
    expect(createdRes.status).toBe(200);

    const updated = buildStripeSubscriptionEvent({
      eventId: "evt_4008_updated",
      eventType: "customer.subscription.updated",
      tenantId: tenantStringId,
      subscriptionId: "sub_4008",
      customerId: "cus_4008",
      priceId: "price_business_yearly",
    });
    const updatedSig = await signEvent(JSON.stringify(updated));
    const updatedRes = await postStripeWebhook(JSON.stringify(updated), updatedSig);
    expect(updatedRes.status).toBe(200);

    const admin = createTestUser({
      id: 4008,
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

    const esEvents = await loadAggregate(
      db,
      subscriptionAggregateId(tenantStringId),
      tenantStringId,
    );
    expect(esEvents).toHaveLength(2);
    expect(esEvents[1]?.type).toBe("billing-foundation:event:subscription-updated");
  });
});

// =============================================================================
// Scenario 5: runtime-secret path — the webhook verifies against a system
// secret seeded in the database, not the factory fallback. Verifies end-to-end
// resolution and that the system secret takes precedence over the fallback
// (rotation without redeployment).
// =============================================================================

const SEEDED_WEBHOOK_SECRET = "whsec_runtime_seeded_distinct";
const SEEDED_API_KEY = "sk_test_runtime_seeded";

describe("scenario 5: runtime-secret resolution", () => {
  test("seeded system-secret schlägt factory-fallback: sig gegen seeded secret → 200 + DB-row", async () => {
    // Set both keys via config:write:set (backing:"secrets") as SystemAdmin,
    // exactly as the generated Sysadmin-configEdit screen or the bridge seed
    // dispatches in production. The value is JSON-serialized and envelope-
    // encrypted in the secrets store; the webhook resolves it through
    // parseStoredSecret.
    // SEEDED_WEBHOOK_SECRET ≠ TEST_SECRET (the fallback).
    const sysAdmin = createTestUser({
      id: 9001,
      tenantId: SYSTEM_TENANT_ID,
      roles: ["SystemAdmin"],
    });
    await stack.http.writeOk(
      "config:write:set",
      { key: API_KEY_CONFIG_QN, value: SEEDED_API_KEY, scope: "system" },
      sysAdmin,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: WEBHOOK_SECRET_CONFIG_QN, value: SEEDED_WEBHOOK_SECRET, scope: "system" },
      sysAdmin,
    );

    const tenantStringId = testTenantId(4005);
    const payload = JSON.stringify(
      buildStripeSubscriptionEvent({
        eventId: "evt_4005_runtime",
        tenantId: tenantStringId,
        subscriptionId: "sub_4005",
        customerId: "cus_4005",
        priceId: "price_pro_monthly",
      }),
    );
    // Sign with the seeded secret — if the webhook still used the fallback
    // (TEST_SECRET), verification would fail.
    const sig = await signEvent(payload, SEEDED_WEBHOOK_SECRET);

    const res = await postStripeWebhook(payload, sig);
    expect(res.status).toBe(200);

    const admin = createTestUser({
      id: 4005,
      tenantId: tenantStringId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const subs = (await stack.http.queryOk(
      "billing-foundation:query:subscription:list",
      {},
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]?.["providerSubscriptionId"]).toBe("sub_4005");
    expect(subs.rows[0]?.["tier"]).toBe("pro");
  });

  test("sig gegen den (jetzt obsoleten) fallback-secret → 401, wenn system-secret gesetzt ist", async () => {
    // Drift pin for precedence: after the system secret is set, the old
    // environment/fallback secret must no longer verify.
    const payload = JSON.stringify(
      buildStripeSubscriptionEvent({ eventId: "evt_4005_stale", tenantId: testTenantId(4006) }),
    );
    const sigWithStaleFallback = await signEvent(payload, TEST_SECRET);
    const res = await postStripeWebhook(payload, sigWithStaleFallback);
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Scenario 6: billing-live gate through the full stack.
//
// The invariant that live checkout is unavailable until billing-live is true
// was previously tested only with a stubbed ctx.config (runtime.test.ts); no
// test exercised the factory → r.config → ctx.config(handle) chain for real.
// This stack has no api-key or webhook-secret fallback, so opening the gate
// exposes an UnconfiguredError (the api key is missing) instead of making a
// real Stripe network call. A default-off check alone is insufficient: it
// cannot distinguish a correct handle whose value is missing from an incorrect
// handle that always returns undefined (both produce feature_disabled). The
// positive case, setting billing-live through config:write:set on the
// canonical qualified name, verifies handle resolution for real.
// =============================================================================

const BILLING_LIVE_CONFIG_QN = "subscription-stripe:config:billing-live";

describe("scenario 6: billing-live gate end-to-end (#104)", () => {
  let gateStack: TestStack;

  beforeAll(async () => {
    const stripeFeature = createSubscriptionStripeFeature({
      priceToTier: PRICE_TO_TIER,
      // A fallback key so isBillingEnabled (checkout-core's pre-flight
      // gate) reports true once billing-live flips — without one the gate
      // stays closed forever and the flip-open branch below is unreachable.
      apiKey: "sk_test_fake_for_gate_test",
    });
    const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
    const resolver = createConfigResolver({ cipher: encryption });
    const masterKeyProvider = createEnvMasterKeyProvider({
      env: {
        KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      },
    });
    gateStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createSecretsFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        createTenantLifecycleFeature(),
        // baseUrl must match checkoutPayload's successUrl/cancelUrl origin —
        // otherwise create-checkout-session's redirect-origin hardening
        // fires before the billing-live gate this scenario pins the order of.
        // checkout-core's openCheckout now runs assertBillingEnabled (which
        // wraps isBillingEnabled) before that origin check for every mode.
        createBillingFoundationFeature({ baseUrl: "https://app.example.com" }),
        stripeFeature,
      ],
      masterKeyProvider,
      extraContext: ({ db: ctxDb, registry }) => ({
        configResolver: resolver,
        configEncryption: encryption,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
        secrets: createSecretsContext({ db: ctxDb, masterKeyProvider, registry: registry }),
      }),
    });
    await unsafeCreateEntityTable(gateStack.db, tenantEntity);
    await unsafePushTables(gateStack.db, {
      configValuesTable,
      tenant_secrets: tenantSecretsTable,
    });
  });

  afterAll(async () => {
    await gateStack.cleanup();
  });

  const checkoutPayload = {
    providerName: "stripe",
    priceId: "price_pro_monthly",
    successUrl: "https://app.example.com/ok",
    cancelUrl: "https://app.example.com/cancel",
  };

  test("default-off → feature_disabled; config-flip → Gate öffnet (Handle-Resolution real)", async () => {
    const tenantAdmin = createTestUser({
      id: 6001,
      tenantId: testTenantId(6001),
      roles: ["TenantAdmin"],
    });

    // billing-live ungesetzt → Gate zu, throw VOR jedem api-key/Stripe-Schritt.
    const closed = await gateStack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      checkoutPayload,
      tenantAdmin,
    );
    expect(closed.code).toBe("feature_disabled");

    // Set billing-live=true on the canonical qualified name, as the generated
    // Sysadmin-configEdit screen dispatches in production.
    const sysAdmin = createTestUser({
      id: 6002,
      tenantId: SYSTEM_TENANT_ID,
      roles: ["SystemAdmin"],
    });
    await gateStack.http.writeOk(
      "config:write:set",
      { key: BILLING_LIVE_CONFIG_QN, value: true, scope: "system" },
      sysAdmin,
    );

    // Gate now open, no longer feature_disabled. isBillingEnabled (=
    // billing-live AND an api-key existence probe — the fallback key above
    // satisfies it) now returns true, so openCheckout's pre-flight gate
    // passes through to the actual price-catalog check, which rejects an
    // unknown priceId as 422 unknown_price (never reaching Stripe — no live
    // call). A mis-qualified billing-live handle would leave ctx.config
    // undefined, so isBillingEnabled stays false and the error stays
    // feature_disabled, which step 1 above already pins.
    const opened = await gateStack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      { ...checkoutPayload, priceId: "price_unknown_not_in_catalog" },
      tenantAdmin,
    );
    expect(opened.code).not.toBe("feature_disabled");
    expect(opened.httpStatus).toBe(422);
    expect(opened.i18nKey).toBe("billing-foundation.errors.unknownPrice");
  });
});
