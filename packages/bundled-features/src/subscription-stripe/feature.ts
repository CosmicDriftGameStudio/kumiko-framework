// kumiko-feature-version: 1
//
// subscription-stripe — Stripe-Plugin für die subscription-foundation
// Plugin-API.
//
// **Factory-Pattern (= createSubscriptionStripeFeature(options)):**
// Im Gegensatz zu mail-transport-smtp / file-provider-s3 (die ihre
// secrets aus tenant-secrets lesen) ist Stripe's webhook-secret
// **app-wide** — App-Owner hat einen Stripe-account, alle Webhooks
// gehen dorthin. Plugin braucht den secret beim webhook-sig-verify-
// Zeitpunkt, der ist PRE-tenant-resolution (kein ctx).
//
// Lösung: factory-Funktion `createSubscriptionStripeFeature(options)`
// liest webhook-secret + apiKey beim mount-time aus dem Caller (= App-
// Builder's bin/server.ts der's aus process.env zieht). Closure
// hält's für den verifyAndParseWebhook-call.
//
// Beispiel-Verwendung in run-config.ts:
//
//   import { createSubscriptionStripeFeature } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
//
//   const features = [
//     billingFoundationFeature,
//     createSubscriptionStripeFeature({
//       webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
//       apiKey: process.env.STRIPE_API_KEY ?? "",
//       priceToTier: {
//         "price_1ABC": "pro",
//         "price_1XYZ": "business",
//       },
//     }),
//   ];
//
// **Pattern-Vorbild:** mirrors createFeatureTogglesFeature(options) —
// gleiche factory-Form für features die module-load-time-Konfiguration
// haben (analog zum FeatureToggle-runtime-holder).

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import Stripe from "stripe";
import { z } from "zod";
import { STRIPE_PROVIDER_NAME, SUBSCRIPTION_STRIPE_FEATURE } from "./constants";
import {
  createStripeCancelSubscription,
  createStripeCheckoutSession,
  createStripePortalSession,
} from "./plugin-methods";
import { verifyAndParseStripeWebhook } from "./verify-webhook";

/**
 * Env-vars contract for the `subscription-stripe` feature.
 *
 * The feature itself reads via factory-options (`createSubscriptionStripeFeature({
 * webhookSecret, apiKey })`), so the schema is a Kumiko-pattern contract:
 * apps that mount stripe SHOULD load `STRIPE_WEBHOOK_SECRET` / `STRIPE_API_KEY`
 * from env and forward them. `composeEnvSchema({ features: [stripeFeature] })`
 * surfaces missing/empty values at boot, before
 * `createSubscriptionStripeFeature` throws on `webhookSecret.length === 0`.
 */
export const subscriptionStripeEnvSchema = z.object({
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_/, "STRIPE_WEBHOOK_SECRET must start with 'whsec_'")
    .describe("Stripe webhook-signing secret (`whsec_...` from the Stripe dashboard).")
    .meta({ kumiko: { pulumi: { secret: true } } }),
  STRIPE_API_KEY: z
    .string()
    .regex(/^sk_(test|live)_/, "STRIPE_API_KEY must start with 'sk_test_' or 'sk_live_'")
    .describe("Stripe API key (`sk_live_...` / `sk_test_...`).")
    .meta({ kumiko: { pulumi: { secret: true } } }),
});

export type SubscriptionStripeOptions = {
  /** Webhook-secret aus dem Stripe-Dashboard. App-wide. Plugin throws
   *  beim runtime wenn empty (= App-Owner hat sub-stripe gemountet
   *  aber Stripe-Account nicht konfiguriert). */
  readonly webhookSecret: string;
  /** Stripe-API-key (sk_live_... / sk_test_...). Heute nur für
   *  constructEvent-API-Version-Pin gebraucht; Phase 5.2b nutzt's
   *  für outgoing-API-calls (createPortalSession etc.). */
  readonly apiKey: string;
  /** Price-to-tier-Mapping. Plugin liest die price-id aus Stripe-event
   *  (subscription.items.data[0].price.id) und mappt auf einen tier-
   *  name. Fehlt die price-id im Mapping → null (foundation 200
   *  ignored — App-Owner-Bug, hat den Stripe-price angelegt aber
   *  nicht zur tier zugeordnet). */
  readonly priceToTier: Readonly<Record<string, string>>;
};

/**
 * Factory für das subscription-stripe-feature. Wird mit den App-Owner-
 * eigenen Stripe-Credentials gemountet. Der returnte FeatureDefinition
 * registriert den Plugin gegen subscription-foundation's
 * "subscriptionProvider"-extension-point unter entityName "stripe".
 */
export function createSubscriptionStripeFeature(
  options: SubscriptionStripeOptions,
): FeatureDefinition {
  // Module-load-Validation: ohne webhook-secret kann der Plugin keinen
  // single Webhook verifizieren. Throw vor dem mount damit der App-
  // Owner nicht zur Laufzeit Mystery-401s sieht.
  if (options.webhookSecret.length === 0) {
    throw new Error(
      "subscription-stripe: webhookSecret is empty. Set STRIPE_WEBHOOK_SECRET (or system-config) before mounting.",
    );
  }
  if (options.apiKey.length === 0) {
    throw new Error(
      "subscription-stripe: apiKey is empty. Set STRIPE_API_KEY (or system-config) before mounting.",
    );
  }

  // EIN Stripe-Client für alle vier plugin-methods (verify-webhook +
  // checkout + portal + cancel). API-version-pin zentral, kein
  // Connection-Duplikat.
  const stripe = new Stripe(options.apiKey, { apiVersion: "2026-04-22.dahlia" });

  const verifyAndParse = verifyAndParseStripeWebhook(stripe, {
    webhookSecret: options.webhookSecret,
    priceToTier: options.priceToTier,
  });
  const checkoutSession = createStripeCheckoutSession(stripe);
  const portalSession = createStripePortalSession(stripe);
  const cancel = createStripeCancelSubscription(stripe);

  return defineFeature(SUBSCRIPTION_STRIPE_FEATURE, (r) => {
    // Hard-deps: subscription-foundation als plugin-host. KEIN
    // `r.requires("config", "secrets")` — der Plugin nutzt weder
    // tenant-config noch tenant-secrets (alles app-wide via factory-
    // options).
    r.requires("billing-foundation");
    r.envSchema(subscriptionStripeEnvSchema);

    // Plugin: register against subscription-foundation's
    // "subscriptionProvider" extension. entityName "stripe" matcht den
    // path-segment in der webhook-URL (`/api/subscription/webhook/stripe`).
    const plugin: SubscriptionProviderPlugin = {
      verifyAndParseWebhook: verifyAndParse,
      createCheckoutSession: checkoutSession,
      createPortalSession: portalSession,
      cancelSubscription: cancel,
    };
    r.useExtension("subscriptionProvider", STRIPE_PROVIDER_NAME, plugin);
  });
}
