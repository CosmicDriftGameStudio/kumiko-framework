// kumiko-feature-version: 1
//
// subscription-paddle — Paddle Billing (merchant of record) plugin for the
// billing-foundation plugin API. Credentials, the billing-live master switch and
// the API environment (sandbox | live) are config keys resolved at call time, like
// subscription-stripe. The `apiKey` / `webhookSecret` / `tenantBindingKey` /
// `clientToken` options are env→config bridge fallbacks.

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  access,
  createSystemConfig,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { type FeatureWithEnvSchema, featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { egress } from "@cosmicdrift/kumiko-framework/http";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { makeCheckoutConfigQuery } from "./checkout-config.query.ts";
import {
  createPaddleCancelSubscription,
  createPaddleCheckoutSession,
  createPaddlePortalSession,
  createPaddleResumeSubscription,
} from "./checkout-methods.ts";
import { servePaddleCheckoutPage } from "./checkout-page.ts";
import type { PaddleSend } from "./client.ts";
import {
  PADDLE_API_KEY_CONFIG,
  PADDLE_BILLING_LIVE_CONFIG,
  PADDLE_CLIENT_TOKEN_CONFIG,
  PADDLE_ENVIRONMENT_CONFIG,
  PADDLE_PROVIDER_NAME,
  PADDLE_TENANT_BINDING_KEY_CONFIG,
  PADDLE_WEBHOOK_SECRET_CONFIG,
  PaddleEnvironments,
  SUBSCRIPTION_PADDLE_FEATURE,
} from "./constants.ts";
import {
  createPaddleApplyPlanSwitch,
  createPaddlePreviewPlanSwitch,
  createPaddleRetrieveSubscription,
} from "./plan-switch-methods.ts";
import { createPaddlePriceCache, createPaddleRetrievePrices } from "./price-methods.ts";
import { createPaddleRuntimes } from "./runtime.ts";
import { verifyAndParsePaddleWebhook } from "./webhook-events.ts";

/** Bridge contract: all fields are optional fallbacks for the config store. */
export const subscriptionPaddleEnvSchema = z.object({
  PADDLE_API_KEY: z
    .string()
    .min(1)
    .describe("Paddle API key. Bridge-fallback — prefer the secret.")
    .meta({ kumiko: { pulumi: { secret: true } } })
    .optional(),
  PADDLE_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .describe("Paddle notification secret (`pdl_ntfset_...`). Bridge-fallback — prefer the secret.")
    .meta({ kumiko: { pulumi: { secret: true } } })
    .optional(),
  PADDLE_TENANT_BINDING_KEY: z
    .string()
    .min(1)
    .describe(
      "Server-only HMAC key binding a Paddle checkout to its tenant. Bridge-fallback — prefer the secret.",
    )
    .meta({ kumiko: { pulumi: { secret: true } } })
    .optional(),
  PADDLE_CLIENT_TOKEN: z
    .string()
    .regex(/^(test|live)_/, "PADDLE_CLIENT_TOKEN must start with 'test_' or 'live_'")
    .describe("Paddle.js client-side token (public). Bridge-fallback for the config key.")
    .optional(),
});

type PaddlePriceEnvShape<TPrice extends string> = {
  [Key in `PADDLE_PRICE_${TPrice}`]: z.ZodOptional<z.ZodString>;
};

/** Paddle env block plus one `PADDLE_PRICE_<NAME>` slot per plan price the app
 *  maps to a tier, e.g. `paddleEnvSchema({ prices: ["PRO", "TEAM"] })`.
 *  Shares its bridge fields with `subscriptionPaddleEnvSchema`, so spreading
 *  it into `composeEnvSchema({ extend })` next to the mounted feature is no
 *  key clash. */
export function paddleEnvSchema<const TPrice extends string>(options: {
  readonly prices: readonly TPrice[];
}) {
  const priceShape = Object.fromEntries(
    options.prices.map((price) => [
      `PADDLE_PRICE_${price}`,
      z
        .string()
        .regex(/^pri_/, `PADDLE_PRICE_${price} must start with 'pri_'`)
        .optional()
        .describe(`Paddle price id (\`pri_...\`) of the ${price} plan.`),
    ]),
    // @cast-boundary schema-walk — Object.fromEntries widens to an index signature; the entries are exactly one optional string per listed price.
  ) as PaddlePriceEnvShape<TPrice>;
  return z.object({ ...subscriptionPaddleEnvSchema.shape, ...priceShape });
}

export type SubscriptionPaddleOptions = {
  /** Bridge-fallback API key; the `api-key` config key wins when set. */
  readonly apiKey?: string;
  /** Bridge-fallback webhook secret; the `webhook-secret` config key wins when set. */
  readonly webhookSecret?: string;
  /** Bridge-fallback tenant binding key; the `tenant-binding-key` config key wins when set. */
  readonly tenantBindingKey?: string;
  /** Bridge-fallback Paddle.js client token; the `client-token` config key wins when set. */
  readonly clientToken?: string;
  /** Paddle price id → app tier name. Prices absent here drop the event. */
  readonly priceToTier?: Readonly<Record<string, string>>;
  /** Price ids a mode:"payment" checkout may target; empty = one-off checkouts closed. */
  readonly oneOffPriceIds?: readonly string[];
  /** HTTP transport; defaults to the SSRF-safe external egress. Test seam. */
  readonly send?: PaddleSend;
  /** Epoch milliseconds for the plan-switch preview timestamp. Test seam. */
  readonly now?: () => number;
  /** Unix seconds for the webhook tolerance window. Test seam. */
  readonly nowSeconds?: () => number;
};

// Validated once at feature-build time so a typo fails app startup instead of
// silently widening or narrowing the one-off allowlist at request time.
function validateOneOffPriceIds(priceIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const priceId of priceIds) {
    if (priceId.length === 0) {
      throw new Error("subscription-paddle: oneOffPriceIds must not contain an empty string");
    }
    if (seen.has(priceId)) {
      throw new Error(`subscription-paddle: duplicate oneOffPriceIds entry "${priceId}"`);
    }
    seen.add(priceId);
  }
}

export function createSubscriptionPaddleFeature(
  options: SubscriptionPaddleOptions = {},
): FeatureWithEnvSchema<FeatureDefinition, typeof subscriptionPaddleEnvSchema.shape> {
  validateOneOffPriceIds(options.oneOffPriceIds ?? []);
  const now = options.now ?? (() => Temporal.Now.instant().epochMilliseconds);
  const feature: FeatureDefinition = defineFeature(SUBSCRIPTION_PADDLE_FEATURE, (r) => {
    r.describe(
      'Paddle Billing provider plugin for `billing-foundation`. Paddle acts as merchant of record: it sells to the customer and issues invoice and VAT, so the consumer-protection texts for this provider come from `consumerProtection.providerTexts`. Reads its API key, webhook secret and tenant binding key from system config keys with `backing:"secrets"` (envelope-encrypted in the secrets store under the system tenant), the public Paddle.js `client-token`, a `billingLive` master switch and an `environment` key (sandbox | live). `environment` is its own key because Paddle serves sandbox and live from different API hosts and a live key must never hit the sandbox host or the other way round; `billingLive` only decides whether checkouts are offered at all. All of them are runtime config, so keys rotate and prod goes live without a redeploy, and the `mask` on each derives the sysadmin settings screen and nav. Mount via `createSubscriptionPaddleFeature({ priceToTier })`; the optional `apiKey`/`webhookSecret`/`tenantBindingKey`/`clientToken` options are env to config bridge fallbacks (`PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_TENANT_BINDING_KEY`, `PADDLE_CLIENT_TOKEN`). The plugin always mounts; `createCheckoutSession` throws `feature_disabled` unless `billingLive` is true, and billing counts as enabled only with API key and binding key present. Webhooks arrive at `/webhooks/subscription/paddle` when mounted through the server-runtime `billing.paddle` boot option, or at `/api/subscription/webhook/paddle` when `createSubscriptionWebhookRoute` is mounted by hand and are verified with the `Paddle-Signature` header (HMAC-SHA256 over `ts:rawBody` keyed with the raw secret, any `h1` may match, 5 minute tolerance). Paddle.js can open checkouts with arbitrary `customData` from the browser, so `custom_data.tenantId` is only trusted together with `tenantBinding`, an HMAC of the tenant id under the binding key; events without a valid binding, for prices outside `priceToTier` or without a tenant are dropped. Rotating the binding key makes the webhooks of existing subscriptions fail that check until they are re-bound. Paddle has no hosted checkout page, so the feature serves the Default Payment Link itself at `/billing/paddle-checkout` (set it as the default payment link in the Paddle dashboard): an anonymous page with its own CSP that loads Paddle.js from cdn.paddle.com, the one external script this framework allows, and opens the overlay for the transaction. Implements checkout, customer portal, cancel and resume, `retrievePrices` (batched, 10-minute TTL cache), `retrieveSubscription` for the sync job, and an in-app plan switch: `previewPlanSwitch` shows the proration before the customer confirms, `applyPlanSwitch` changes the plan without a hosted page and waits for the `subscription.updated` webhook to move the tier.',
    );
    r.uiHints({
      displayLabel: "Billing · Paddle",
      category: "billing",
      recommended: false,
    });
    r.requires({ features: ["billing-foundation"] });
    r.requires({ features: ["config"] });
    r.requires({ features: ["secrets"] });
    r.envSchema(subscriptionPaddleEnvSchema);

    const configKeys = r.config({
      keys: {
        [PADDLE_API_KEY_CONFIG]: createSystemConfig("text", {
          backing: "secrets",
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-paddle.api-key", icon: "key", order: 1 },
        }),
        [PADDLE_WEBHOOK_SECRET_CONFIG]: createSystemConfig("text", {
          backing: "secrets",
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-paddle.webhook-secret", icon: "shield", order: 2 },
        }),
        [PADDLE_TENANT_BINDING_KEY_CONFIG]: createSystemConfig("text", {
          backing: "secrets",
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-paddle.tenant-binding-key", icon: "lock", order: 3 },
        }),
        [PADDLE_CLIENT_TOKEN_CONFIG]: createSystemConfig("text", {
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-paddle.client-token", icon: "settings", order: 4 },
        }),
        [PADDLE_ENVIRONMENT_CONFIG]: createSystemConfig("select", {
          default: PaddleEnvironments.sandbox,
          options: [PaddleEnvironments.sandbox, PaddleEnvironments.live],
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-paddle.environment", icon: "server", order: 5 },
        }),
        [PADDLE_BILLING_LIVE_CONFIG]: createSystemConfig("boolean", {
          default: false,
          write: access.privileged,
          read: access.admin,
          mask: { title: "subscription-paddle.billing-live", icon: "rocket", order: 6 },
        }),
      },
    });

    r.translations({
      keys: {
        "subscription-paddle.api-key": { en: "Paddle API key" },
        "subscription-paddle.webhook-secret": { en: "Paddle webhook secret" },
        "subscription-paddle.tenant-binding-key": { en: "Paddle tenant binding key" },
        "subscription-paddle.client-token": { en: "Paddle client-side token" },
        "subscription-paddle.environment": { en: "Paddle environment" },
        "subscription-paddle.billing-live": { en: "Live billing" },
        "subscription-paddle.settings": { en: "Paddle" },
        "screen:subscription-paddle-system.title": { en: "Paddle" },
      },
    });

    const priceToTier = options.priceToTier ?? {};
    const runtimes = createPaddleRuntimes({
      apiKeyHandle: configKeys[PADDLE_API_KEY_CONFIG],
      webhookSecretHandle: configKeys[PADDLE_WEBHOOK_SECRET_CONFIG],
      tenantBindingKeyHandle: configKeys[PADDLE_TENANT_BINDING_KEY_CONFIG],
      clientTokenHandle: configKeys[PADDLE_CLIENT_TOKEN_CONFIG],
      billingLiveHandle: configKeys[PADDLE_BILLING_LIVE_CONFIG],
      environmentHandle: configKeys[PADDLE_ENVIRONMENT_CONFIG],
      send: options.send ?? egress({ kind: "external" }),
      fallback: {
        ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
        ...(options.webhookSecret !== undefined && { webhookSecret: options.webhookSecret }),
        ...(options.tenantBindingKey !== undefined && {
          tenantBindingKey: options.tenantBindingKey,
        }),
        ...(options.clientToken !== undefined && { clientToken: options.clientToken }),
      },
    });

    r.queryHandler(makeCheckoutConfigQuery(runtimes.readCheckoutConfig));
    r.httpRoute({
      method: "GET",
      // Literal for the feature-AST extractor; must equal PADDLE_CHECKOUT_PATH (integration test).
      path: "/billing/paddle-checkout",
      anonymous: true,
      rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
      handler: (c, deps) => servePaddleCheckoutPage(c, deps),
    });

    const plugin: SubscriptionProviderPlugin = {
      displayName: "Paddle",
      verifyAndParseWebhook: verifyAndParsePaddleWebhook(runtimes.webhook, {
        priceToTier,
        ...(options.nowSeconds && { nowSeconds: options.nowSeconds }),
      }),
      createCheckoutSession: createPaddleCheckoutSession(runtimes.ctx),
      createPortalSession: createPaddlePortalSession(runtimes.ctx),
      cancelSubscription: createPaddleCancelSubscription(runtimes.ctx),
      resumeSubscription: createPaddleResumeSubscription(runtimes.ctx),
      priceToTier,
      oneOffPriceIds: options.oneOffPriceIds ?? [],
      isBillingEnabled: runtimes.ctx.isBillingEnabled,
      retrievePrices: createPaddleRetrievePrices(runtimes.ctx, createPaddlePriceCache({ now })),
      retrieveSubscription: createPaddleRetrieveSubscription(runtimes.ctx, { priceToTier }),
      previewPlanSwitch: createPaddlePreviewPlanSwitch(runtimes.ctx, now),
      applyPlanSwitch: createPaddleApplyPlanSwitch(runtimes.ctx),
    };
    r.useExtension("subscriptionProvider", PADDLE_PROVIDER_NAME, plugin);

    return { configKeys };
  });
  return featureWithEnvSchema(feature, subscriptionPaddleEnvSchema);
}
