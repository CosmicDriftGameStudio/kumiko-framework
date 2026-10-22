// kumiko-feature-version: 1
//
// subscription-dodo — Dodo Payments (merchant of record) plugin for the
// billing-foundation plugin API. Credentials, the billing-live master switch and
// the API environment (test | live) are config keys resolved at call time, like
// subscription-stripe. `apiKey` / `webhookSecret` options are env→secrets bridge
// fallbacks.

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  access,
  createSystemConfig,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { type FeatureWithEnvSchema, featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { egress } from "@cosmicdrift/kumiko-framework/http";
import * as z from "zod";
import type { DodoSend } from "./client.ts";
import {
  DODO_API_KEY_CONFIG,
  DODO_BILLING_LIVE_CONFIG,
  DODO_ENVIRONMENT_CONFIG,
  DODO_PROVIDER_NAME,
  DODO_WEBHOOK_SECRET_CONFIG,
  DodoEnvironments,
  SUBSCRIPTION_DODO_FEATURE,
} from "./constants.ts";
import {
  createDodoApplyPlanSwitch,
  createDodoCancelSubscription,
  createDodoCheckoutSession,
  createDodoPortalSession,
  createDodoPreviewPlanSwitch,
  createDodoPriceCache,
  createDodoResumeSubscription,
  createDodoRetrievePrices,
  createDodoRetrieveSubscription,
} from "./plugin-methods.ts";
import { createDodoRuntimes } from "./runtime.ts";
import { verifyAndParseDodoWebhook } from "./verify-webhook.ts";

/** Bridge contract: both fields are optional fallbacks for the secrets store. */
export const subscriptionDodoEnvSchema = z.object({
  DODO_PAYMENTS_API_KEY: z
    .string()
    .min(1)
    .describe("Dodo Payments API key. Bridge-fallback — prefer the secret.")
    .meta({ kumiko: { pulumi: { secret: true } } })
    .optional(),
  DODO_PAYMENTS_WEBHOOK_KEY: z
    .string()
    .min(1)
    .describe(
      "Dodo Payments webhook signing key (`whsec_...`). Bridge-fallback — prefer the secret.",
    )
    .meta({ kumiko: { pulumi: { secret: true } } })
    .optional(),
});

export type SubscriptionDodoOptions = {
  /** Bridge-fallback API key; the `api-key` config key wins when set. */
  readonly apiKey?: string;
  /** Bridge-fallback webhook secret; the `webhook-secret` config key wins when set. */
  readonly webhookSecret?: string;
  /** Dodo product id → app tier name. Products absent here drop the event. */
  readonly priceToTier?: Readonly<Record<string, string>>;
  /** Product ids a mode:"payment" checkout may target; empty = one-off checkouts closed. */
  readonly oneOffPriceIds?: readonly string[];
  /** HTTP transport; defaults to the SSRF-safe external egress. Test seam. */
  readonly send?: DodoSend;
};

// Validated once at feature-build time so a typo fails app startup instead of
// silently widening or narrowing the one-off allowlist at request time.
function validateOneOffPriceIds(priceIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const priceId of priceIds) {
    if (priceId.length === 0) {
      throw new Error("subscription-dodo: oneOffPriceIds must not contain an empty string");
    }
    if (seen.has(priceId)) {
      throw new Error(`subscription-dodo: duplicate oneOffPriceIds entry "${priceId}"`);
    }
    seen.add(priceId);
  }
}

export function createSubscriptionDodoFeature(
  options: SubscriptionDodoOptions = {},
): FeatureWithEnvSchema<FeatureDefinition, typeof subscriptionDodoEnvSchema.shape> {
  validateOneOffPriceIds(options.oneOffPriceIds ?? []);
  const feature: FeatureDefinition = defineFeature(SUBSCRIPTION_DODO_FEATURE, (r) => {
    r.describe(
      'Dodo Payments provider plugin for `billing-foundation`. Dodo acts as merchant of record: it sells to the customer and issues invoice and VAT, so the consumer-protection texts for this provider come from `consumerProtection.providerTexts`. Reads its API key and webhook secret from system config keys with `backing:"secrets"` (envelope-encrypted in the secrets store under the system tenant), plus a `billingLive` master switch and an `environment` key (test | live). `environment` is its own key because Dodo serves test and live mode from different API hosts and a live key must never hit the test host or the other way round; `billingLive` only decides whether checkouts are offered at all. All four are runtime config, so keys rotate and prod goes live without a redeploy, and the `mask` on each derives the sysadmin settings screen and nav. Mount via `createSubscriptionDodoFeature({ priceToTier })`; the optional `apiKey`/`webhookSecret` options are env to secrets bridge fallbacks (`DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`). The plugin always mounts; `createCheckoutSession` throws `feature_disabled` unless `billingLive` is true. Webhooks arrive at `/api/subscription/webhook/dodo` and are verified per the Standard Webhooks spec (HMAC-SHA256 over id, timestamp and the raw body, 5 minute tolerance); events for products outside `priceToTier` or without tenant metadata are dropped. Implements hosted checkout, customer portal, cancel and resume, `retrievePrices` (10-minute TTL cache), `retrieveSubscription` for the sync job, and an in-app plan switch: `previewPlanSwitch` shows the proration before the customer confirms, `applyPlanSwitch` changes the plan without a hosted page and waits for the `plan_changed` webhook to move the tier. A plan switch in Dodo requires all plan products to belong to one Product Collection.',
    );
    r.uiHints({
      displayLabel: "Billing · Dodo Payments",
      category: "billing",
      recommended: false,
    });
    r.requires({ features: ["billing-foundation"] });
    r.requires({ features: ["config"] });
    r.requires({ features: ["secrets"] });
    r.envSchema(subscriptionDodoEnvSchema);

    const configKeys = r.config({
      keys: {
        [DODO_API_KEY_CONFIG]: createSystemConfig("text", {
          backing: "secrets",
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-dodo.api-key", icon: "key", order: 1 },
        }),
        [DODO_WEBHOOK_SECRET_CONFIG]: createSystemConfig("text", {
          backing: "secrets",
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-dodo.webhook-secret", icon: "shield", order: 2 },
        }),
        [DODO_ENVIRONMENT_CONFIG]: createSystemConfig("select", {
          default: DodoEnvironments.test,
          options: [DodoEnvironments.test, DodoEnvironments.live],
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-dodo.environment", icon: "server", order: 3 },
        }),
        [DODO_BILLING_LIVE_CONFIG]: createSystemConfig("boolean", {
          default: false,
          write: access.privileged,
          read: access.admin,
          mask: { title: "subscription-dodo.billing-live", icon: "rocket", order: 4 },
        }),
      },
    });

    r.translations({
      keys: {
        "subscription-dodo.api-key": { en: "Dodo Payments API key" },
        "subscription-dodo.webhook-secret": { en: "Dodo Payments webhook secret" },
        "subscription-dodo.environment": { en: "Dodo Payments environment" },
        "subscription-dodo.billing-live": { en: "Live billing" },
        "subscription-dodo.settings": { en: "Dodo Payments" },
        "screen:subscription-dodo-system.title": { en: "Dodo Payments" },
      },
    });

    const priceToTier = options.priceToTier ?? {};
    const runtimes = createDodoRuntimes({
      apiKeyHandle: configKeys[DODO_API_KEY_CONFIG],
      webhookSecretHandle: configKeys[DODO_WEBHOOK_SECRET_CONFIG],
      billingLiveHandle: configKeys[DODO_BILLING_LIVE_CONFIG],
      environmentHandle: configKeys[DODO_ENVIRONMENT_CONFIG],
      send: options.send ?? egress({ kind: "external" }),
      fallback: {
        ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
        ...(options.webhookSecret !== undefined && { webhookSecret: options.webhookSecret }),
      },
    });

    const plugin: SubscriptionProviderPlugin = {
      displayName: "Dodo Payments",
      verifyAndParseWebhook: verifyAndParseDodoWebhook(runtimes.webhook, { priceToTier }),
      createCheckoutSession: createDodoCheckoutSession(runtimes.ctx),
      createPortalSession: createDodoPortalSession(runtimes.ctx),
      cancelSubscription: createDodoCancelSubscription(runtimes.ctx),
      resumeSubscription: createDodoResumeSubscription(runtimes.ctx),
      priceToTier,
      oneOffPriceIds: options.oneOffPriceIds ?? [],
      isBillingEnabled: runtimes.ctx.isBillingEnabled,
      retrievePrices: createDodoRetrievePrices(runtimes.ctx, createDodoPriceCache()),
      retrieveSubscription: createDodoRetrieveSubscription(runtimes.ctx, { priceToTier }),
      previewPlanSwitch: createDodoPreviewPlanSwitch(runtimes.ctx),
      applyPlanSwitch: createDodoApplyPlanSwitch(runtimes.ctx),
    };
    r.useExtension("subscriptionProvider", DODO_PROVIDER_NAME, plugin);

    return { configKeys };
  });
  return featureWithEnvSchema(feature, subscriptionDodoEnvSchema);
}
