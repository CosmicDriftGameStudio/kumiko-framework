// kumiko-feature-version: 3
//
// subscription-stripe — Stripe plugin for the billing-foundation
// plugin API.
//
// **Runtime config (v3):** Stripe credentials and the billing-live master
// switch come from the config feature AT RUNTIME, no longer from a
// mount-time closure. This allows keys to rotate and production to go live
// without a redeploy — and the input form is generated automatically.
//   - `subscription-stripe:config:api-key` + `:webhook-secret` → system
//     config keys with **backing:"secrets"**: the value is envelope-encrypted
//     in the secrets store under SYSTEM_TENANT_ID and addressed as a
//     config key. `mask` derives the sysadmin configEdit screen +
//     Settings-Hub navigation — the app no longer needs handwritten
//     r.screen/r.nav entries (v2 used `r.secret` keys + an app-owned form).
//   - `subscription-stripe:config:billing-live` (shortKey `billingLive`,
//     kebab-qualified by r.config) → **system config**
//     (boolean, default false). The master switch: without it, checkout may
//     not create a Stripe session; this is enforced in the
//     createCheckoutSession gate.
//
// **Factory options as fallback:** `createSubscriptionStripeFeature({
// apiKey, webhookSecret, priceToTier })` remains — apiKey/webhookSecret
// are now OPTIONAL and serve only as fallbacks during the env→secrets
// bridge phase and in tests that do not wire a secrets context. `priceToTier`
// (Stripe price ID → app tier name) remains a factory option: it is
// app-specific, is not a secret, and changes infrequently.
//
// **Webhook + system secrets:** verifyAndParseWebhook is pre-tenant
// (no ctx). The billing-foundation webhook handler passes a system-scoped
// SecretsContext as the third argument, from which the plugin reads the
// api key + webhook secret without auditing (a sanctioned framework-internal
// read).

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  access,
  createSystemConfig,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { type FeatureWithEnvSchema, featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import * as z from "zod";
import {
  STRIPE_API_KEY_CONFIG,
  STRIPE_BILLING_LIVE_CONFIG,
  STRIPE_PROVIDER_NAME,
  STRIPE_WEBHOOK_SECRET_CONFIG,
  SUBSCRIPTION_STRIPE_FEATURE,
} from "./constants.ts";
import {
  createStripeCancelSubscription,
  createStripeCheckoutSession,
  createStripePlanSwitchSession,
  createStripePortalSession,
  createStripePriceCache,
  createStripeResumeSubscription,
  createStripeRetrievePrices,
  createStripeRetrieveSubscription,
} from "./plugin-methods.ts";
import { createStripeRuntimes } from "./runtime.ts";
import { verifyAndParseStripeWebhook } from "./verify-webhook.ts";

/**
 * Env-vars contract for the `subscription-stripe` feature — now a **bridge
 * contract**: both fields are optional. v2 reads credentials from secrets
 * at runtime; `STRIPE_WEBHOOK_SECRET` / `STRIPE_API_KEY` are only consumed
 * as factory-fallback during the env→secrets transition. The regex still
 * validates the shape when a value IS present, so a typo'd bridge key fails
 * at boot rather than at the first webhook.
 */
export const subscriptionStripeEnvSchema = z.object({
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_/, "STRIPE_WEBHOOK_SECRET must start with 'whsec_'")
    .describe("Stripe webhook-signing secret (`whsec_...`). Bridge-fallback — prefer the secret.")
    .meta({ kumiko: { pulumi: { secret: true } } })
    .optional(),
  STRIPE_API_KEY: z
    .string()
    .regex(
      /^(sk|rk)_(test|live)_/,
      "STRIPE_API_KEY must start with 'sk_test_'/'sk_live_' or a restricted 'rk_test_'/'rk_live_' key",
    )
    .describe(
      "Stripe API key (`sk_live_...` / `sk_test_...`). Bridge-fallback — prefer the secret.",
    )
    .meta({ kumiko: { pulumi: { secret: true } } })
    .optional(),
});

type StripePriceEnvShape<TPrice extends string> = {
  [Key in `STRIPE_PRICE_${TPrice}`]: z.ZodOptional<z.ZodString>;
};

/** Stripe env block plus one `STRIPE_PRICE_<NAME>` slot per price the app
 *  maps to a tier, e.g. `stripeEnvSchema({ prices: ["PRO", "TEAM"] })`.
 *  Shares its bridge fields with `subscriptionStripeEnvSchema`, so spreading
 *  it into `composeEnvSchema({ extend })` next to the mounted feature is no
 *  key clash. */
export function stripeEnvSchema<const TPrice extends string>(options: {
  readonly prices: readonly TPrice[];
}) {
  const priceShape = Object.fromEntries(
    options.prices.map((price) => [
      `STRIPE_PRICE_${price}`,
      z
        .string()
        .regex(/^price_/, `STRIPE_PRICE_${price} must start with 'price_'`)
        .optional()
        .describe(`Stripe price id (\`price_...\`) of the ${price} plan.`),
    ]),
    // @cast-boundary schema-walk — Object.fromEntries widens to an index signature; the entries are exactly one optional string per listed price.
  ) as StripePriceEnvShape<TPrice>;
  return z.object({ ...subscriptionStripeEnvSchema.shape, ...priceShape });
}

export type SubscriptionStripeOptions = {
  /** Bridge-fallback webhook secret. Optional: v2 reads from the
   *  `subscription-stripe:config:webhook-secret` key (backing:"secrets").
   *  Set only during the env→secrets transition phase / in tests. */
  readonly webhookSecret?: string;
  /** Bridge-fallback API key. Optional: v2 reads from the
   *  `subscription-stripe:config:api-key` key (backing:"secrets"). */
  readonly apiKey?: string;
  /** Price-to-tier mapping. The plugin reads the price ID from the Stripe
   *  event (subscription.items.data[0].price.id) and maps it to a tier name.
   *  App-specific, so it remains a factory option. If the price ID is absent
   *  from the mapping → null (event ignored). */
  readonly priceToTier?: Readonly<Record<string, string>>;
  /** Whether a mode:"payment" checkout (one-off top-ups etc.) gets a Stripe
   *  invoice — a receipt/invoice document Stripe generates and sends to the
   *  customer for that payment. Default true. Stripe Invoicing charges a
   *  per-invoice fee on top of the payment itself, so a high-volume,
   *  low-value payment flow may want `false` to opt out. Never applied in
   *  mode:"subscription" — Stripe rejects invoice_creation there; the
   *  subscription's own invoicing covers it. */
  readonly paymentInvoiceCreation?: boolean;
  /** Allowlist of Stripe price-ids a mode:"payment" (one-off) checkout may
   *  target — checkout-core's `openCheckout` rejects any other priceId as
   *  `unknown_price`. App-specific and empty by default: without an
   *  explicit allowlist every one-off checkout is closed, the same
   *  fail-closed default `priceToTier` has for mode:"subscription". */
  readonly oneOffPriceIds?: readonly string[];
};

// Validated once at feature-build time (not per-request) so a config typo
// (a pasted-twice priceId, a blank string from a bad env-join) fails app
// startup instead of silently widening — or narrowing — the one-off
// allowlist at request time. Mirrors legal-pages' validateRoutes.
function validateOneOffPriceIds(priceIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const priceId of priceIds) {
    if (priceId.length === 0) {
      throw new Error("subscription-stripe: oneOffPriceIds must not contain an empty string");
    }
    if (seen.has(priceId)) {
      throw new Error(`subscription-stripe: duplicate oneOffPriceIds entry "${priceId}"`);
    }
    seen.add(priceId);
  }
}

/**
 * Factory for the subscription-stripe feature. Always mounts (no
 * key-presence guard) — activity is gated at runtime through config/secrets
 * (following the feature-toggles pattern). The returned FeatureDefinition
 * registers the plugin under billing-foundation's "subscriptionProvider"
 * extension with entityName "stripe".
 */
export function createSubscriptionStripeFeature(
  options: SubscriptionStripeOptions = {},
): FeatureWithEnvSchema<FeatureDefinition, typeof subscriptionStripeEnvSchema.shape> {
  validateOneOffPriceIds(options.oneOffPriceIds ?? []);
  const feature: FeatureDefinition = defineFeature(SUBSCRIPTION_STRIPE_FEATURE, (r) => {
    r.describe(
      'Stripe payment provider plugin for `billing-foundation`. Reads its Stripe API key + webhook secret from system config keys with `backing:"secrets"` (envelope-encrypted in the secrets store under the system tenant) and a `billingLive` **system config** flag — all at runtime, so keys rotate and prod goes live without a redeploy. The `mask` on each key derives the sysadmin settings screen + nav, so no app wires a hand-written config UI. Mount via `createSubscriptionStripeFeature({ priceToTier })`; the optional `apiKey`/`webhookSecret` options are env→secrets bridge fallbacks. The plugin always mounts — `createCheckoutSession` throws `feature_disabled` unless `billingLive` is true, so sk_test_ keys in prod never produce a live checkout. Implements webhook verify, checkout, portal, cancel, `retrievePrices` (10-minute TTL-cached price lookup for the billing-plans catalog), `createPlanSwitchSession` (auto-provisions a Customer-Portal configuration for switching an existing subscription to another plan tier — each tier needs its own Stripe product), `retrieveSubscription` (live provider-side snapshot for the `sync-subscriptions` backfill job, mapped identically to the webhook path), plus `isBillingEnabled` (billingLive + an api-key existence probe, no secret read).',
    );
    r.uiHints({
      displayLabel: "Billing · Stripe",
      category: "billing",
      recommended: false,
    });
    // Hard-deps: billing-foundation (plugin-host) + config (billing-live +
    // backing:"secrets" credentials) + secrets (the store the backing:secrets
    // dispatch reads/writes + its tenant_secrets table).
    r.requires({ features: ["billing-foundation"] });
    r.requires({ features: ["config"] });
    r.requires({ features: ["secrets"] });
    r.envSchema(subscriptionStripeEnvSchema);

    // Runtime config. api-key + webhook-secret declare backing:"secrets" —
    // the value lives envelope-encrypted in the secrets store under
    // SYSTEM_TENANT_ID, while `mask` derives the sysadmin settings screen +
    // Settings-Hub nav (no hand-written r.screen/r.nav in the consuming app).
    // billingLive is the master switch. The factory-fallback
    // (options.apiKey/.webhookSecret) covers the env→secrets bridge + tests.
    const configKeys = r.config({
      keys: {
        [STRIPE_API_KEY_CONFIG]: createSystemConfig("text", {
          backing: "secrets",
          // Prefix guard, matching subscriptionStripeEnvSchema:
          // catches the wrong-field paste error (pk_/price_) without
          // constraining the base62 body. Anchored, with no backtracking → no ReDoS.
          pattern: { regex: "^(sk|rk)_(test|live)_" },
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-stripe.api-key", icon: "key", order: 1 },
        }),
        [STRIPE_WEBHOOK_SECRET_CONFIG]: createSystemConfig("text", {
          backing: "secrets",
          pattern: { regex: "^whsec_" },
          write: access.systemAdmin,
          read: access.admin,
          mask: { title: "subscription-stripe.webhook-secret", icon: "shield", order: 2 },
        }),
        [STRIPE_BILLING_LIVE_CONFIG]: createSystemConfig("boolean", {
          default: false,
          // privileged = ["system", "SystemAdmin"]: preserves the legacy
          // writeAs(system-actor) flip path while the derived configEdit
          // screen lets a human SystemAdmin toggle go-live directly.
          write: access.privileged,
          read: access.admin,
          mask: { title: "subscription-stripe.billing-live", icon: "rocket", order: 3 },
        }),
      },
    });

    r.translations({
      keys: {
        "subscription-stripe.api-key": { en: "Stripe API key" },
        "subscription-stripe.webhook-secret": { en: "Stripe webhook secret" },
        "subscription-stripe.billing-live": { en: "Live billing" },
        "subscription-stripe.settings": { en: "Stripe" },
        "screen:subscription-stripe-system.title": { en: "Stripe" },
      },
    });

    const runtimes = createStripeRuntimes({
      apiKeyHandle: configKeys[STRIPE_API_KEY_CONFIG],
      webhookSecretHandle: configKeys[STRIPE_WEBHOOK_SECRET_CONFIG],
      billingLiveHandle: configKeys[STRIPE_BILLING_LIVE_CONFIG],
      fallback: {
        ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
        ...(options.webhookSecret !== undefined && { webhookSecret: options.webhookSecret }),
      },
    });

    const priceCache = createStripePriceCache();
    const portalConfigurationCache = new Map<string, string>();

    const plugin: SubscriptionProviderPlugin = {
      verifyAndParseWebhook: verifyAndParseStripeWebhook(runtimes.webhook, {
        priceToTier: options.priceToTier ?? {},
      }),
      createCheckoutSession: createStripeCheckoutSession(runtimes.ctx, {
        ...(options.paymentInvoiceCreation !== undefined && {
          paymentInvoiceCreation: options.paymentInvoiceCreation,
        }),
      }),
      createPortalSession: createStripePortalSession(runtimes.ctx),
      cancelSubscription: createStripeCancelSubscription(runtimes.ctx),
      resumeSubscription: createStripeResumeSubscription(runtimes.ctx),
      priceToTier: options.priceToTier ?? {},
      oneOffPriceIds: options.oneOffPriceIds ?? [],
      isBillingEnabled: runtimes.ctx.isBillingEnabled,
      retrievePrices: createStripeRetrievePrices(runtimes.ctx, priceCache),
      retrieveSubscription: createStripeRetrieveSubscription(runtimes.ctx, {
        priceToTier: options.priceToTier ?? {},
      }),
      createPlanSwitchSession: createStripePlanSwitchSession(
        runtimes.ctx,
        priceCache,
        portalConfigurationCache,
      ),
    };
    r.useExtension("subscriptionProvider", STRIPE_PROVIDER_NAME, plugin);

    return { configKeys };
  });
  return featureWithEnvSchema(feature, subscriptionStripeEnvSchema);
}
