// kumiko-feature-version: 1
//
// subscription-mollie — Mollie-Plugin für die subscription-foundation
// Plugin-API (EU-Compliance-Story für DACH-Mid-Market).
//
// **Factory-Pattern (analog subscription-stripe):** liest API-key beim
// mount-time aus den factory-options (typisch process.env aus dem App-
// Builder-bin/server.ts). Mollie hat KEIN webhook-secret — Mollie-SDK
// 4.5.0 bietet keine native HMAC-sig-verify-API. Sicherheit kommt aus
// nicht-guessable IDs + API-Validation; App-Builder kann optional
// einen URL-Token-Wrapper davor schalten.
//
// **Phase-5.3-Scope:**
//   - verifyAndParseWebhook ✓ (lazy-fetch payment + subscription via
//     Mollie-API, heuristisches event-type-mapping)
//   - createCheckoutSession ✓ (Mollie's mehrstufiger flow: customer
//     anlegen + first-payment mit sequenceType="first" → redirectUrl)
//   - createPortalSession ✗ (Mollie hat keinen Customer-Portal)
//   - cancelSubscription ✗ (Mollie braucht customerId zusätzlich zur
//     subId; Plugin-Contract reicht's nicht durch — App-Builder cancelt
//     via Mollie-Dashboard oder custom-route)
//
// **Beispiel-Verwendung in run-config.ts:**
//
//   const features = [
//     subscriptionFoundationFeature,
//     createSubscriptionMollieFeature({
//       apiKey: process.env.MOLLIE_API_KEY ?? "",
//       webhookUrl: "https://app.example.com/api/subscription/webhook/mollie",
//       priceToTier: { plan_pro: "pro", plan_business: "business" },
//       priceToConfig: {
//         plan_pro: {
//           amountValue: "9.99",
//           amountCurrency: "EUR",
//           interval: "1 month",
//           description: "Pro-Abo monatlich",
//         },
//       },
//     }),
//   ];

import type { SubscriptionProviderPlugin } from "@kumiko/bundled-features/subscription-foundation";
import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { createMollieClient } from "@mollie/api-client";
import { MOLLIE_PROVIDER_NAME, SUBSCRIPTION_MOLLIE_FEATURE } from "./constants";
import { createMollieCheckoutSession, type MolliePriceConfig } from "./plugin-methods";
import { verifyAndParseMollieWebhook } from "./verify-webhook";

export type SubscriptionMollieOptions = {
  /** Mollie-API-key (`test_...` oder `live_...`). App-wide, beim Plugin-
   *  mount aus process.env oder system-config. */
  readonly apiKey: string;
  /** Foundation-webhook-URL die der App-Builder unter Mollie-Dashboard
   *  als webhook eingetragen hat. Plugin reicht das beim payment-
   *  create an Mollie weiter — Mollie sendet beim payment-event
   *  webhooks an diese URL. Typisch:
   *  `https://app.example.com/api/subscription/webhook/mollie`. */
  readonly webhookUrl: string;
  /** Price-to-tier-Map. Plugin liest die priceId aus dem subscription-
   *  metadata (= `metadata.priceId` den der App-Builder beim
   *  createCheckoutSession setzt) und mappt auf einen tier-name. */
  readonly priceToTier: Readonly<Record<string, string>>;
  /** Mollie-Subscription-Setup pro priceId. Mollie hat keinen nativen
   *  price-id-Konzept — App-Builder muss pro virtuellem priceId einen
   *  amount/interval/description bereitstellen. */
  readonly priceToConfig: Readonly<Record<string, MolliePriceConfig>>;
};

export function createSubscriptionMollieFeature(
  options: SubscriptionMollieOptions,
): FeatureDefinition {
  if (options.apiKey.length === 0) {
    throw new Error(
      "subscription-mollie: apiKey is empty. Set MOLLIE_API_KEY (or system-config) before mounting.",
    );
  }
  if (options.webhookUrl.length === 0) {
    throw new Error(
      "subscription-mollie: webhookUrl is empty. Set the foundation-webhook-URL where Mollie sends events.",
    );
  }

  const client = createMollieClient({ apiKey: options.apiKey });

  // Adapter um den Plugin's verify-fetch-client an den vollen Mollie-
  // Client zu binden. Plugin-fetch-API ist minimal damit Tests ohne
  // den vollen MollieClient mocken können.
  const fetchAdapter = {
    payments: { get: (id: string) => client.payments.get(id) },
    customerSubscriptions: {
      get: (subId: string, customerId: string) =>
        client.customerSubscriptions.get(subId, { customerId }),
    },
  };

  const verifyAndParse = verifyAndParseMollieWebhook(fetchAdapter, {
    priceToTier: options.priceToTier,
  });
  const checkoutSession = createMollieCheckoutSession(
    client,
    options.priceToConfig,
    options.webhookUrl,
  );

  return defineFeature(SUBSCRIPTION_MOLLIE_FEATURE, (r) => {
    r.requires("subscription-foundation");

    const plugin: SubscriptionProviderPlugin = {
      verifyAndParseWebhook: verifyAndParse,
      createCheckoutSession: checkoutSession,
      // createPortalSession + cancelSubscription bewusst nicht — siehe
      // plugin-methods.ts für Begründung.
    };
    r.useExtension("subscriptionProvider", MOLLIE_PROVIDER_NAME, plugin);
  });
}
