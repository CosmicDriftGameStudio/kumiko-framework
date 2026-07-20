// feature.ts contract tests for subscription-stripe.

import { describe, expect, spyOn, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import Stripe from "stripe";
import { describeSubscriptionProviderContract } from "../../billing-foundation/__tests__/subscription-provider-contract";
import { STRIPE_PROVIDER_NAME, StripeEventTypes, SUBSCRIPTION_STRIPE_FEATURE } from "../constants";
import { createSubscriptionStripeFeature } from "../feature";
import {
  createStripeCancelSubscription,
  createStripeCheckoutSession,
  createStripePortalSession,
} from "../plugin-methods";
import type { StripeCtxRuntime } from "../runtime";
import { verifyAndParseStripeWebhook } from "../verify-webhook";

const OPTIONS = {
  priceToTier: { price_test: "pro" },
};

describe("createSubscriptionStripeFeature — shape", () => {
  test("has the expected name", () => {
    const feature = createSubscriptionStripeFeature(OPTIONS);
    expect(feature.name).toBe(SUBSCRIPTION_STRIPE_FEATURE);
    expect(feature.name).toBe("subscription-stripe");
  });

  test("requires billing-foundation + config + secrets (runtime-keys via config/secrets)", () => {
    const feature = createSubscriptionStripeFeature(OPTIONS);
    expect(feature.requires).toContain("billing-foundation");
    // Drift-Pin (v3): api-key/webhook-secret sind config-Keys mit
    // backing:"secrets" (Wert im secrets-Store), billing-live plain config —
    // daher harte deps auf config UND secrets (Store + tenant_secrets-Tabelle).
    expect(feature.requires).toContain("config");
    expect(feature.requires).toContain("secrets");
  });
});

describe("createSubscriptionStripeFeature — mounts without mount-time credentials", () => {
  test("mounts with no options at all (keys resolved at runtime from secrets)", () => {
    // v1 warf hier bei leerem webhookSecret/apiKey. v2 mountet immer —
    // die Credentials kommen erst zur Laufzeit aus config/secrets, der
    // billing-live-Gate hält den Checkout solange inert.
    expect(() => createSubscriptionStripeFeature()).not.toThrow();
  });

  test("mounts with only priceToTier (no api/webhook keys passed)", () => {
    expect(() =>
      createSubscriptionStripeFeature({ priceToTier: { price_x: "pro" } }),
    ).not.toThrow();
  });

  test("mounts with bridge-fallback keys passed (env→secrets transition)", () => {
    expect(() =>
      createSubscriptionStripeFeature({
        apiKey: "sk_test_dummy",
        webhookSecret: "whsec_dummy",
        priceToTier: { price_x: "pro" },
      }),
    ).not.toThrow();
  });
});

describe("subscription-stripe — plugin-registration", () => {
  test("registers itself under entityName 'stripe' for billing-foundation's extension", () => {
    const feature = createSubscriptionStripeFeature(OPTIONS);
    const usages = feature.extensionUsages;
    expect(
      usages.some(
        (u) => u.extensionName === "subscriptionProvider" && u.entityName === STRIPE_PROVIDER_NAME,
      ),
    ).toBe(true);
  });

  test("plugin-options have a valid SubscriptionProviderPlugin shape (drift-pin alle 4 methods)", () => {
    // Stärker als nur "extension-usage existiert": wenn jemand eine der
    // plugin-methods aus dem plugin-build entfernt, würde der
    // entsprechende Foundation-write-handler zur Laufzeit als
    // "method not supported"-error brechen — type-check würde es nicht
    // fangen weil die useExtension-options als `unknown` durchgereicht
    // werden.
    // Checks the mounted feature — the contract below builds its plugin
    // by hand-wiring, so it would not catch a wiring gap here.
    const feature = createSubscriptionStripeFeature(OPTIONS);
    const usage = feature.extensionUsages.find((u) => u.entityName === STRIPE_PROVIDER_NAME);
    expect(usage).toBeDefined();
    const options = usage?.options as {
      verifyAndParseWebhook?: unknown;
      createCheckoutSession?: unknown;
      createPortalSession?: unknown;
      cancelSubscription?: unknown;
    };
    expect(typeof options?.verifyAndParseWebhook).toBe("function");
    expect(typeof options?.createCheckoutSession).toBe("function");
    expect(typeof options?.createPortalSession).toBe("function");
    expect(typeof options?.cancelSubscription).toBe("function");
  });
});

describe("constants — Stripe-event-types die wir mappen", () => {
  test("StripeEventTypes whitelist — was die Foundation verarbeitet", () => {
    // Drift-Pin: ein Refactor das einen event-type rauswirft (z.B.
    // invoice.paid weil "wir nutzen das nicht") würde tier-grace-period-
    // tracking brechen. Plus: ein Refactor der einen NICHT-existing
    // Stripe-event-type reinschreibt (typo) würde silent ignored werden.
    expect(Object.values(StripeEventTypes)).toEqual([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
    ]);
  });
});

// =============================================================================
// SubscriptionProviderPlugin contract
// =============================================================================
//
// Built directly from the plugin-method constructors (not from
// createSubscriptionStripeFeature's mounted plugin) — the mounted plugin
// resolves its Stripe client per-call from ctx.config/ctx.secrets, which
// can't be spied on from outside. plugin-methods.test.ts already exercises
// this same runtime-injection pattern for the individual methods.

const CONTRACT_API_KEY = "sk_test_contract_dummy";
const CONTRACT_WEBHOOK_SECRET = "whsec_contract_test_secret";

function contractCtxRuntime(stripe: Stripe): StripeCtxRuntime {
  return { clientForCtx: async () => stripe, assertBillingLive: async () => {} };
}

async function buildStripeContractFixture() {
  const stripe = new Stripe(CONTRACT_API_KEY);
  spyOn(stripe.checkout.sessions, "create").mockResolvedValue({
    url: "https://checkout.stripe.com/c/pay/contract-test",
    // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
  } as any);
  spyOn(stripe.billingPortal.sessions, "create").mockResolvedValue({
    url: "https://billing.stripe.com/p/session/contract-test",
    // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
  } as any);
  spyOn(stripe.subscriptions, "cancel").mockResolvedValue({
    id: "sub_contract",
    status: "canceled",
    // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
  } as any);
  const runtime = contractCtxRuntime(stripe);

  const stripeForWebhookFixture = new Stripe(CONTRACT_API_KEY);
  const webhookEvent = {
    id: "evt_contract_001",
    object: "event",
    api_version: "2026-04-22.dahlia",
    created: 1_770_000_000,
    type: StripeEventTypes.customerSubscriptionCreated,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: "sub_contract_001",
        object: "subscription",
        customer: "cus_contract_001",
        status: "active",
        metadata: { tenantId: "tenant-contract" },
        items: {
          object: "list",
          data: [
            {
              id: "si_contract",
              object: "subscription_item",
              current_period_end: 1_780_000_000,
              price: { id: "price_test", object: "price" },
            },
          ],
          has_more: false,
        },
      },
    },
  };
  const rawBody = JSON.stringify(webhookEvent);
  const signature = await stripeForWebhookFixture.webhooks.generateTestHeaderStringAsync({
    payload: rawBody,
    secret: CONTRACT_WEBHOOK_SECRET,
  });

  return {
    plugin: {
      verifyAndParseWebhook: verifyAndParseStripeWebhook(
        {
          resolve: async () => ({
            stripe: stripeForWebhookFixture,
            webhookSecret: CONTRACT_WEBHOOK_SECRET,
          }),
        },
        { priceToTier: OPTIONS.priceToTier },
      ),
      createCheckoutSession: createStripeCheckoutSession(runtime),
      createPortalSession: createStripePortalSession(runtime),
      cancelSubscription: createStripeCancelSubscription(runtime),
    },
    ctx: {} as HandlerContext,
    checkout: {
      priceId: "price_test",
      tenantId: "tenant-contract",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    },
    portal: { providerCustomerId: "cus_contract", returnUrl: "https://example.com/return" },
    cancelSubscriptionId: "sub_contract",
    webhook: {
      rawBody,
      headers: { "stripe-signature": signature },
      expectedTenantId: "tenant-contract",
      expectedTier: "pro",
    },
  };
}

describeSubscriptionProviderContract("subscription-stripe", buildStripeContractFixture);
