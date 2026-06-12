// kumiko-feature-version: 2
//
// subscription-stripe — Stripe-Plugin für die billing-foundation
// Plugin-API.
//
// **Runtime-config (v2):** Stripe-credentials + der billing-live-Master-
// Switch kommen ZUR LAUFZEIT aus config/secrets, nicht mehr aus einem
// mount-time-Closure. Damit lassen sich Keys rotieren und prod live-
// schalten ohne Redeploy.
//   - `subscription-stripe:api-key` + `:webhook-secret` → **secrets**
//     (encrypted-at-rest), gespeichert/gelesen unter SYSTEM_TENANT_ID
//     (Stripe ist app-wide, secrets-v1 deklariert nur `scope:"tenant"`,
//     also lebt der app-wide-Wert unter dem System-Tenant — dieselbe
//     Konvention die der config-resolver für system-scope-rows nutzt).
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
  createSystemConfig,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import {
  STRIPE_API_KEY_SECRET,
  STRIPE_BILLING_LIVE_CONFIG,
  STRIPE_PROVIDER_NAME,
  STRIPE_WEBHOOK_SECRET_SECRET,
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
  /** Bridge-fallback webhook-secret. Optional: v2 liest aus
   *  `subscription-stripe:webhook-secret` (system-secret). Gesetzt nur
   *  während der env→secrets-Übergangsphase / in Tests. */
  readonly webhookSecret?: string;
  /** Bridge-fallback api-key. Optional: v2 liest aus
   *  `subscription-stripe:api-key` (system-secret). */
  readonly apiKey?: string;
  /** Price-to-tier-Mapping. Plugin liest die price-id aus dem Stripe-event
   *  (subscription.items.data[0].price.id) und mappt auf einen tier-name.
   *  App-spezifisch → bleibt factory-option. Fehlt die price-id im Mapping
   *  → null (event ignored). */
  readonly priceToTier?: Readonly<Record<string, string>>;
};

const SECRET_REDACT = (plaintext: string): string =>
  plaintext.length < 12
    ? "•".repeat(plaintext.length)
    : `${plaintext.slice(0, 8)}...${plaintext.slice(-4)}`;

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
      "Stripe payment provider plugin for `billing-foundation`. Reads its Stripe API key + webhook secret from the **secrets** feature (stored under the system tenant) and a `billingLive` **system config** flag — all at runtime, so keys rotate and prod goes live without a redeploy. Mount via `createSubscriptionStripeFeature({ priceToTier })`; the optional `apiKey`/`webhookSecret` options are env→secrets bridge fallbacks. The plugin always mounts — `createCheckoutSession` throws `feature_disabled` unless `billingLive` is true, so sk_test_ keys in prod never produce a live checkout. Implements all four provider methods (webhook verify, checkout, portal, cancel).",
    );
    // Hard-deps: billing-foundation (plugin-host) + config (billing-live)
    // + secrets (api-key/webhook-secret).
    r.requires("billing-foundation");
    r.requires("config");
    r.requires("secrets");
    r.envSchema(subscriptionStripeEnvSchema);

    // Runtime-credentials. scope "tenant" (secrets-v1) — gespeichert/gelesen
    // unter SYSTEM_TENANT_ID (app-wide). required:false: der factory-Fallback
    // deckt die Bridge-Phase, also kein readiness-false-negative.
    const apiKeySecret = r.secret(STRIPE_API_KEY_SECRET, {
      label: { de: "Stripe API Key", en: "Stripe API Key" },
      hint: {
        de: "Geheimer Stripe-Schlüssel (`sk_live_...`). Im Stripe-Dashboard unter Entwickler → API-Schlüssel.",
        en: "Stripe secret key (`sk_live_...`). Stripe dashboard → Developers → API keys.",
      },
      redact: SECRET_REDACT,
      scope: "tenant",
      required: false,
    });
    const webhookSecret = r.secret(STRIPE_WEBHOOK_SECRET_SECRET, {
      label: { de: "Stripe Webhook Secret", en: "Stripe Webhook Secret" },
      hint: {
        de: "Webhook-Signing-Secret (`whsec_...`). Im Stripe-Dashboard beim Webhook-Endpoint.",
        en: "Webhook signing secret (`whsec_...`). Stripe dashboard → the webhook endpoint.",
      },
      redact: SECRET_REDACT,
      scope: "tenant",
      required: false,
    });

    const configKeys = r.config({
      keys: {
        [STRIPE_BILLING_LIVE_CONFIG]: createSystemConfig("boolean", { default: false }),
      },
    });

    const runtimes = createStripeRuntimes({
      apiKeyHandle: apiKeySecret,
      webhookSecretHandle: webhookSecret,
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

    return { apiKeySecret, webhookSecret, configKeys };
  });
}
