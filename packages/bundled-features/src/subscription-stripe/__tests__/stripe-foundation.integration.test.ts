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

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  billingFoundationFeature,
  createSubscriptionWebhookHandler,
  type SubscriptionProviderPlugin,
  subscriptionAggregateId,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { Hono } from "hono";
import Stripe from "stripe";
import { configValuesTable, createConfigFeature } from "../../config";
import { createConfigAccessorFactory } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import {
  createSecretsContext,
  createSecretsFeature,
  type SecretsContext,
  tenantSecretsTable,
} from "../../secrets";
import { createSubscriptionStripeFeature } from "../feature";

// Qualified-names der runtime-keys (drift-pin: müssen 1:1 dem entsprechen,
// was r.config(...) im feature build qualifiziert — `subscription-stripe:
// config:<shortName>`, backing:"secrets"). Scenario 5 setzt sie via
// config:write:set + beweist die Resolution durch den Webhook.
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
let webhookApp: Hono;
/** Zweite webhook-app MIT system-secrets gewired — für Scenario 5
 *  (runtime-secret-Pfad). */
let webhookAppWithSecrets: Hono;
let secretsCtx: SecretsContext;

const stripeForFixtures = new Stripe(TEST_API_KEY);

beforeAll(async () => {
  // subscription-stripe requires jetzt config + secrets. Scenarios 1–4
  // nutzen den factory-fallback (kein system-secret geseedet, kein
  // systemSecrets gewired) → resolve fällt auf die options-Keys zurück.
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
      billingFoundationFeature,
      stripeFeature,
    ],
    masterKeyProvider,
    extraContext: ({ db: ctxDb, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db: ctxDb, masterKeyProvider }),
    }),
  });
  db = stack.db;
  // subscriptionsProjectionTable wird von setupTestStack automatisch
  // gepusht (r.projection mit `table`-Property → auto-push). config +
  // secrets brauchen ihre Tabellen explizit.
  await createEventsTable(db);
  await unsafePushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
  // Standalone-secrets-context (gleiche KEK) zum direkten Seeden +
  // als systemSecrets für die zweite webhook-app.
  secretsCtx = createSecretsContext({ db, masterKeyProvider });

  // Webhook-app: Hono mit der webhook-handler-Route.
  // dispatchWrite ruft `stack.http.write` mit dem System-User des
  // resolved-Tenants — das ist exakt was der App-Builder im echten
  // bin/server.ts via extraRoutes wireup macht. `systemSecrets` optional:
  // ohne → factory-fallback-Pfad (Scenarios 1–4); mit → runtime-secret-
  // Pfad (Scenario 5), exakt wie der App-Owner createSecretsContext wired.
  const mountWebhook = (systemSecrets?: SecretsContext): Hono => {
    const app = new Hono();
    app.post(
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
        ...(systemSecrets && { systemSecrets }),
      }),
    );
    return app;
  };
  webhookApp = mountWebhook();
  webhookAppWithSecrets = mountWebhook(secretsCtx);
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

async function signEvent(payload: string, secret = TEST_SECRET): Promise<string> {
  return stripeForFixtures.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
  });
}

async function postStripeWebhook(payload: string, sig: string, app: Hono = webhookApp) {
  return app.request("/api/subscription/webhook/stripe", {
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
    const wrongSig = await signEvent(payload, "whsec_wrong_secret");

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
    const sig = await signEvent(payload);

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

// =============================================================================
// Scenario 5: runtime-secret-Pfad — webhook verifiziert gegen ein in der DB
// geseedetes system-secret (NICHT gegen den factory-fallback). Beweist die
// end-to-end-Resolution + dass das system-secret den Fallback schlägt
// (Rotation ohne Redeploy).
// =============================================================================

const SEEDED_WEBHOOK_SECRET = "whsec_runtime_seeded_distinct";
const SEEDED_API_KEY = "sk_test_runtime_seeded";

describe("scenario 5: runtime-secret resolution", () => {
  test("seeded system-secret schlägt factory-fallback: sig gegen seeded secret → 200 + DB-row", async () => {
    // Set beide Keys via config:write:set (backing:"secrets") als SystemAdmin
    // — exakt was der abgeleitete Sysadmin-configEdit-Screen / der Bridge-Seed
    // in prod dispatcht. Der Wert landet JSON-serialisiert envelope-encrypted
    // im secrets-Store; der Webhook löst ihn via parseStoredSecret wieder auf.
    // SEEDED_WEBHOOK_SECRET ≠ TEST_SECRET (der fallback).
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
    // Signiert mit dem GESEEDETEN secret — würde der webhook noch den
    // fallback (TEST_SECRET) nutzen, schlüge die Verifikation fehl.
    const sig = await signEvent(payload, SEEDED_WEBHOOK_SECRET);

    const res = await postStripeWebhook(payload, sig, webhookAppWithSecrets);
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
    // Drift-pin der Präzedenz: nachdem das system-secret gesetzt ist,
    // darf der alte env/fallback-secret NICHT mehr verifizieren.
    const payload = JSON.stringify(
      buildStripeSubscriptionEvent({ eventId: "evt_4005_stale", tenantId: testTenantId(4006) }),
    );
    const sigWithStaleFallback = await signEvent(payload, TEST_SECRET);
    const res = await postStripeWebhook(payload, sigWithStaleFallback, webhookAppWithSecrets);
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Scenario 6: billing-live-Gate (#104) durch den vollen Stack.
//
// Die #104-Invariante (kein Live-Checkout solange billing-live nicht true) war
// bislang nur mit gestubbter ctx.config getestet (runtime.test.ts) — kein Test
// fuhr die Kette factory → r.config → ctx.config(handle) real durch. Eigener
// Stack OHNE api-key/webhook-secret-Fallback, damit das Gate-Öffnen hermetisch
// als UnconfiguredError sichtbar wird (api-key fehlt) statt in einem echten
// Stripe-Netzwerk-Call. Ein reiner default-off-Beweis genügt nicht: er kann
// "korrektes Handle, Wert fehlt" nicht von "falsches Handle, immer undefined"
// trennen (beide → feature_disabled). Erst der positive Fall (billing-live via
// config:write:set auf dem kanonischen QN setzen → Gate öffnet) beweist die
// Handle-Resolution real.
// =============================================================================

const BILLING_LIVE_CONFIG_QN = "subscription-stripe:config:billing-live";

describe("scenario 6: billing-live gate end-to-end (#104)", () => {
  let gateStack: TestStack;

  beforeAll(async () => {
    const stripeFeature = createSubscriptionStripeFeature({ priceToTier: PRICE_TO_TIER });
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
        billingFoundationFeature,
        stripeFeature,
      ],
      masterKeyProvider,
      extraContext: ({ db: ctxDb, registry }) => ({
        configResolver: resolver,
        configEncryption: encryption,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
        secrets: createSecretsContext({ db: ctxDb, masterKeyProvider }),
      }),
    });
    await createEventsTable(gateStack.db);
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

    // billing-live=true auf dem kanonischen QN setzen (was der abgeleitete
    // Sysadmin-configEdit-Screen in prod dispatcht).
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

    // Gate jetzt offen: nicht mehr feature_disabled. Der nächste Schritt
    // (api-key-Resolution) schlägt fehl, weil weder secret noch fallback
    // gesetzt sind → unconfigured. Wäre der billing-live-Handle falsch
    // qualifiziert, bliebe ctx.config undefined → Fehler weiter feature_disabled.
    const opened = await gateStack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      checkoutPayload,
      tenantAdmin,
    );
    expect(opened.code).not.toBe("feature_disabled");
    expect(opened.code).toBe("unconfigured");
  });
});
