import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { SubscriptionFoundationHandlers } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import {
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createSecretsContext,
  createSecretsFeature,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSubscriptionStripeFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { createTenantFeature, tenantEntity } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import {
  TierEngineQueries,
  tierAssignmentEntity,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resolveBillingOption } from "@cosmicdrift/kumiko-server-runtime/boot-options/billing";
import {
  createTestEnvelopeCipher,
  expectSuccess,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { composeSaasStack } from "../compose-stacks.ts";

const WEBHOOK_SECRET = `whsec_${randomBytes(16).toString("hex")}`;
const PRO_PRICE_ID = "price_pro_monthly";

const SUBSCRIPTION_ID = "sub_saas_stack_1";
const CHECKOUT_ID = "cs_saas_stack_1";

// customer.subscription.created resolves its checkout session at Stripe; this local API answers
// that list call with the checkout the test ledgered.
const fixtureApi = Bun.serve({
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/checkout/sessions") return new Response("{}", { status: 404 });
    return Response.json({
      object: "list",
      data: [{ id: CHECKOUT_ID, object: "checkout.session" }],
      has_more: false,
      url: url.pathname,
    });
  },
});

let stack: TestStack;
let webhookPath: string;

// Stripe's v1 scheme: HMAC-SHA256 over "<timestamp>.<payload>".
function stripeSignatureHeader(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function subscriptionCreatedEvent(tenantId: string): string {
  return JSON.stringify({
    id: "evt_saas_stack_1",
    object: "event",
    api_version: "2026-04-22.dahlia",
    created: 1_770_000_000,
    type: "customer.subscription.created",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: SUBSCRIPTION_ID,
        object: "subscription",
        customer: "cus_saas_stack_1",
        status: "active",
        metadata: { tenantId },
        items: {
          object: "list",
          data: [
            {
              id: "si_saas_stack_1",
              object: "subscription_item",
              current_period_end: 1_780_000_000,
              price: { id: PRO_PRICE_ID, object: "price" },
            },
          ],
          has_more: false,
        },
      },
    },
  });
}

beforeAll(async () => {
  const billing = resolveBillingOption(
    { stripe: { priceToTier: { [PRO_PRICE_ID]: "pro" } }, defaultTier: "free" },
    { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API_KEY: "test-stripe-api-key" },
  );
  webhookPath = billing.route.path.replace(":providerName", "stripe");

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
      ...composeSaasStack({
        billing: "stripe",
        tiers: {
          defaultTier: "free",
          tierMap: { free: { features: [], caps: {} }, pro: { features: [], caps: {} } },
        },
      }),
      createSubscriptionStripeFeature({
        priceToTier: { [PRO_PRICE_ID]: "pro" },
        apiKey: "test-stripe-api-key",
        webhookSecret: WEBHOOK_SECRET,
        clientConfig: {
          host: "127.0.0.1",
          port: fixtureApi.port,
          protocol: "http",
          maxNetworkRetries: 0,
        },
      }),
    ],
    masterKeyProvider,
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
    }),
    extraRoutes: [billing.route],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  await fixtureApi.stop(true);
  resetPiiSubjectKmsForTests();
});

describe("composeSaasStack with the Stripe billing option", () => {
  test("a signed subscription webhook assigns the mapped tier", async () => {
    const tenantId = testTenantId(7301);
    const payload = subscriptionCreatedEvent(tenantId);
    expectSuccess(
      await stack.dispatcher.write(
        SubscriptionFoundationHandlers.recordCheckoutOpened,
        {
          providerName: "stripe",
          providerCheckoutId: CHECKOUT_ID,
          priceId: PRO_PRICE_ID,
          mode: "subscription",
        },
        createSystemUser(tenantId, ["SystemAdmin"]),
      ),
    );
    const response = await stack.app.request(webhookPath, {
      method: "POST",
      body: payload,
      headers: {
        "stripe-signature": stripeSignatureHeader(payload),
        "content-type": "application/json",
      },
    });
    expect(response.status).toBe(200);

    const admin = createTestUser({ id: 7301, tenantId, roles: ["SystemAdmin"] });
    const listed = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      TierEngineQueries.list,
      {},
      admin,
    );
    const assignment = listed.rows.find((row) => row["tenantId"] === tenantId);
    expect(assignment?.["tier"]).toBe("pro");
  });

  test("an unsigned webhook is rejected", async () => {
    const response = await stack.app.request(webhookPath, {
      method: "POST",
      body: subscriptionCreatedEvent(testTenantId(7302)),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(401);
  });
});
