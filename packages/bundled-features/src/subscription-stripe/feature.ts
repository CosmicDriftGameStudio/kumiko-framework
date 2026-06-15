// kumiko-feature-version: 3
//
// subscription-stripe — Stripe-Plugin für die billing-foundation
// Plugin-API.
//
// **Runtime-config (v3):** Stripe-credentials + der billing-live-Master-
// Switch kommen ZUR LAUFZEIT aus dem config-Feature, nicht mehr aus einem
// mount-time-Closure. Damit lassen sich Keys rotieren und prod live-
// schalten ohne Redeploy — und die Eingabe-Maske entsteht von selbst.
//   - `subscription-stripe:config:api-key` + `:webhook-secret` → system
//     config keys mit **backing:"secrets"**: der Wert lebt envelope-
//     verschlüsselt im secrets-Store unter SYSTEM_TENANT_ID, adressiert
//     wird er als config-Key. `mask` leitet den Sysadmin-configEdit-Screen
//     + Settings-Hub-Nav ab — kein handgeschriebenes r.screen/r.nav in der
//     App mehr (v2 hatte die Keys als `r.secret` + App-eigene Maske).
//   - `subscription-stripe:config:billingLive` → **system config**
//     (boolean, default false). Der Master-Switch: ohne ihn darf kein
//     checkout eine Stripe-Session erzeugen (#104-Invariante, write-side
//     im createCheckoutSession-Gate durchgesetzt).
//
// **Factory-options als Fallback:** `createSubscriptionStripeFeature({
// apiKey, webhookSecret, priceToTier })` bleibt — apiKey/webhookSecret
// sind jetzt OPTIONAL und dienen nur als Fallback während der env→secrets-
// Bridge-Phase und in Tests, die keinen secrets-context wiren. `priceToTier`
// (Stripe-price-id → app-tier-name) bleibt eine factory-option: app-
// spezifisch, kein Secret, ändert sich selten.
//
// **Webhook + system-secrets:** verifyAndParseWebhook ist pre-tenant
// (kein ctx). Der billing-foundation-webhook-handler reicht einen system-
// scoped SecretsContext als 3. Arg durch, aus dem der Plugin api-key +
// webhook-secret un-audited liest (sanctioned framework-internal read).

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  access,
  createSystemConfig,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import {
  STRIPE_API_KEY_CONFIG,
  STRIPE_BILLING_LIVE_CONFIG,
  STRIPE_PROVIDER_NAME,
  STRIPE_WEBHOOK_SECRET_CONFIG,
  SUBSCRIPTION_STRIPE_FEATURE,
} from "./constants";
import {
  createStripeCancelSubscription,
  createStripeCheckoutSession,
  createStripePortalSession,
} from "./plugin-methods";
import { createStripeRuntimes } from "./runtime";
import { verifyAndParseStripeWebhook } from "./verify-webhook";

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

export type SubscriptionStripeOptions = {
  /** Bridge-fallback webhook-secret. Optional: v2 liest aus dem
   *  `subscription-stripe:config:webhook-secret`-Key (backing:"secrets").
   *  Gesetzt nur während der env→secrets-Übergangsphase / in Tests. */
  readonly webhookSecret?: string;
  /** Bridge-fallback api-key. Optional: v2 liest aus dem
   *  `subscription-stripe:config:api-key`-Key (backing:"secrets"). */
  readonly apiKey?: string;
  /** Price-to-tier-Mapping. Plugin liest die price-id aus dem Stripe-event
   *  (subscription.items.data[0].price.id) und mappt auf einen tier-name.
   *  App-spezifisch → bleibt factory-option. Fehlt die price-id im Mapping
   *  → null (event ignored). */
  readonly priceToTier?: Readonly<Record<string, string>>;
};

/**
 * Factory für das subscription-stripe-feature. Mountet IMMER (kein
 * key-presence-Guard mehr) — die Aktivität wird runtime über config/secrets
 * gegatet (Muster wie feature-toggles). Der returnte FeatureDefinition
 * registriert den Plugin gegen billing-foundation's "subscriptionProvider"-
 * extension unter entityName "stripe".
 */
export function createSubscriptionStripeFeature(
  options: SubscriptionStripeOptions = {},
): FeatureDefinition {
  return defineFeature(SUBSCRIPTION_STRIPE_FEATURE, (r) => {
    r.describe(
      'Stripe payment provider plugin for `billing-foundation`. Reads its Stripe API key + webhook secret from system config keys with `backing:"secrets"` (envelope-encrypted in the secrets store under the system tenant) and a `billingLive` **system config** flag — all at runtime, so keys rotate and prod goes live without a redeploy. The `mask` on each key derives the sysadmin settings screen + nav, so no app wires a hand-written config UI. Mount via `createSubscriptionStripeFeature({ priceToTier })`; the optional `apiKey`/`webhookSecret` options are env→secrets bridge fallbacks. The plugin always mounts — `createCheckoutSession` throws `feature_disabled` unless `billingLive` is true, so sk_test_ keys in prod never produce a live checkout. Implements all four provider methods (webhook verify, checkout, portal, cancel).',
    );
    // Hard-deps: billing-foundation (plugin-host) + config (billing-live +
    // backing:"secrets" credentials) + secrets (the store the backing:secrets
    // dispatch reads/writes + its tenant_secrets table).
    r.requires("billing-foundation");
    r.requires("config");
    r.requires("secrets");
    r.envSchema(subscriptionStripeEnvSchema);

    // Runtime config. api-key + webhook-secret declare backing:"secrets" —
    // the value lives envelope-encrypted in the secrets store under
    // SYSTEM_TENANT_ID, while `mask` derives the sysadmin settings screen +
    // Settings-Hub nav (no hand-written r.screen/r.nav in the consuming app).
    // billingLive is the #104 master switch. The factory-fallback
    // (options.apiKey/.webhookSecret) covers the env→secrets bridge + tests.
    const configKeys = r.config({
      keys: {
        [STRIPE_API_KEY_CONFIG]: createSystemConfig("text", {
          backing: "secrets",
          // Prefix-Guard, deckungsgleich mit subscriptionStripeEnvSchema:
          // fängt den Paste-the-wrong-field-Fehler (pk_/price_), ohne den
          // base62-Body zu constrainen. Anchored, kein Backtracking → kein ReDoS.
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
        "subscription-stripe.api-key": { de: "Stripe API Key", en: "Stripe API Key" },
        "subscription-stripe.webhook-secret": {
          de: "Stripe Webhook Secret",
          en: "Stripe Webhook Secret",
        },
        "subscription-stripe.billing-live": {
          de: "Stripe Billing live",
          en: "Stripe Billing Live",
        },
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

    const plugin: SubscriptionProviderPlugin = {
      verifyAndParseWebhook: verifyAndParseStripeWebhook(runtimes.webhook, {
        priceToTier: options.priceToTier ?? {},
      }),
      createCheckoutSession: createStripeCheckoutSession(runtimes.ctx),
      createPortalSession: createStripePortalSession(runtimes.ctx),
      cancelSubscription: createStripeCancelSubscription(runtimes.ctx),
    };
    r.useExtension("subscriptionProvider", STRIPE_PROVIDER_NAME, plugin);

    return { configKeys };
  });
}
