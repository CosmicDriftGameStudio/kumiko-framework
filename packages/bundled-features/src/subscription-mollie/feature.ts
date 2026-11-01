// kumiko-feature-version: 1
//
// subscription-mollie — Mollie plugin for subscription-foundation
// plugin API (EU compliance for the DACH mid-market).
//
// **Factory pattern (analogous to subscription-stripe):** reads the API key
// at mount time from the factory options (typically process.env from the app
// builder's bin/server.ts). Mollie has NO webhook secret — Mollie SDK
// 4.5.0 provides no native HMAC signature verification API. Security comes
// from non-guessable IDs + API validation; the app builder can optionally
// add a URL-token wrapper in front.
//
// **Scope:**
//   - verifyAndParseWebhook ✓ (lazy-fetch payment + subscription via
//     Mollie API, heuristic event-type mapping)
//   - createCheckoutSession ✓ (Mollie's multistep flow: create customer
//     + first payment with sequenceType="first" → redirectUrl)
//   - createPortalSession ✗ (Mollie has no customer portal)
//   - cancelSubscription ✗ (Mollie additionally requires customerId besides
//     subId; the plugin contract does not pass it through — the app builder
//     cancels via the Mollie dashboard or a custom route)
//
// **Example usage in run-config.ts:**
//
//   const features = [
//     billingFoundationFeature,
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

import type { SubscriptionProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  bootRuleError,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createMollieClient } from "@mollie/api-client";
import * as z from "zod";
import { SUBSCRIPTION_MOLLIE_BOOT_RULES } from "./boot-rules.ts";
import { MOLLIE_PROVIDER_NAME, SUBSCRIPTION_MOLLIE_FEATURE } from "./constants.ts";
import { createMollieCheckoutSession, type MolliePriceConfig } from "./plugin-methods.ts";
import { type MollieClientShape, verifyAndParseMollieWebhook } from "./verify-webhook.ts";

/**
 * Env-vars contract for the `subscription-mollie` feature.
 * Apps load `MOLLIE_API_KEY` from env and forward it to
 * `createSubscriptionMollieFeature({ apiKey, ... })`.
 */
export const subscriptionMollieEnvSchema = z.object({
  MOLLIE_API_KEY: z
    .string()
    .min(1, "MOLLIE_API_KEY must not be empty")
    .regex(/^(test|live)_/, "MOLLIE_API_KEY must start with 'test_' or 'live_'")
    .describe("Mollie API key (`test_...` for sandbox, `live_...` for production).")
    .meta({ kumiko: { pulumi: { secret: true } } }),
});

export type SubscriptionMollieOptions = {
  /** Mollie API key (`test_...` or `live_...`). App-wide, mounted from
   *  process.env or system configuration. */
  readonly apiKey: string;
  /** Foundation webhook URL registered by the app builder in the Mollie
   *  dashboard. The plugin passes it to Mollie when creating a payment;
   *  Mollie sends payment-event webhooks to this URL. Typically:
   *  `https://app.example.com/api/subscription/webhook/mollie`. */
  readonly webhookUrl: string;
  /** Price-to-tier map. The plugin reads the priceId from the subscription
   *  metadata (= `metadata.priceId` set by the app builder when calling
   *  createCheckoutSession) and maps it to a tier name. */
  readonly priceToTier: Readonly<Record<string, string>>;
  /** Mollie subscription setup per priceId. Mollie has no native price-ID
   *  concept, so the app builder must provide an amount/interval/description
   *  for each virtual priceId. */
  readonly priceToConfig: Readonly<Record<string, MolliePriceConfig>>;
  /** @internal Test-only injection port: replaces the verify-webhook fetch
   *  client with a mock instance. Production leaves this undefined; the
   *  factory builds the adapter from `createMollieClient(apiKey)`. The
   *  integration test (mollie-foundation.integration.ts) uses it so the real
   *  factory code (drift validation, plugin registration) runs in the test
   *  path without making Mollie API calls. */
  readonly _clientShapeForTests?: MollieClientShape;
};

export function createSubscriptionMollieFeature(
  options: SubscriptionMollieOptions,
): FeatureDefinition {
  if (options.apiKey.length === 0) {
    throw bootRuleError(SUBSCRIPTION_MOLLIE_BOOT_RULES.emptyApiKey, {
      message:
        "subscription-mollie: apiKey is empty. Set MOLLIE_API_KEY (or system-config) before mounting.",
    });
  }
  if (options.webhookUrl.length === 0) {
    throw bootRuleError(SUBSCRIPTION_MOLLIE_BOOT_RULES.emptyWebhookUrl, {
      message:
        "subscription-mollie: webhookUrl is empty. Set the foundation-webhook-URL where Mollie sends events.",
    });
  }

  // Drift guard: priceToTier and priceToConfig must have identical keys;
  // otherwise verifyAndParseWebhook silently returns null.
  const tierKeys = new Set(Object.keys(options.priceToTier));
  const configKeys = new Set(Object.keys(options.priceToConfig));
  const missingInConfig = [...tierKeys].filter((k) => !configKeys.has(k));
  const missingInTier = [...configKeys].filter((k) => !tierKeys.has(k));
  if (missingInConfig.length > 0 || missingInTier.length > 0) {
    throw bootRuleError(SUBSCRIPTION_MOLLIE_BOOT_RULES.priceMapDrift, {
      message:
        `subscription-mollie: priceToTier ↔ priceToConfig drift — ` +
        `priceIds in tier but missing config: [${missingInConfig.join(", ")}]; ` +
        `priceIds in config but missing tier: [${missingInTier.join(", ")}]`,
    });
  }

  const client = createMollieClient({ apiKey: options.apiKey });

  // Adapter that binds the plugin's minimal fetch client to the full Mollie
  // client. The minimal plugin fetch API lets tests mock it without mocking
  // the full MollieClient.
  const fetchAdapter: MollieClientShape = options._clientShapeForTests ?? {
    payments: { get: (id: string) => client.payments.get(id) },
    customerSubscriptions: {
      get: (subId: string, customerId: string) =>
        client.customerSubscriptions.get(subId, { customerId }),
      list: async (customerId: string) => {
        const page = await client.customerSubscriptions.page({ customerId });
        return [...page];
      },
      create: (customerId, params) =>
        client.customerSubscriptions.create({ customerId, ...params }),
    },
  };

  const verifyAndParse = verifyAndParseMollieWebhook(fetchAdapter, {
    priceToTier: options.priceToTier,
    priceToConfig: options.priceToConfig,
  });
  const checkoutSession = createMollieCheckoutSession(
    client,
    options.priceToConfig,
    options.webhookUrl,
  );

  return defineFeature(SUBSCRIPTION_MOLLIE_FEATURE, (r) => {
    r.describe(
      'Mollie payment provider plugin for `billing-foundation`, covering the DACH/EU mid-market use case. Mount via `createSubscriptionMollieFeature({ apiKey, webhookUrl, priceToTier, priceToConfig })` \u2014 the factory validates that `priceToTier` and `priceToConfig` keys are identical at boot time. Implements `verifyAndParseWebhook` (lazy Mollie-API fetch + heuristic event-type mapping) and `createCheckoutSession` (customer + first-payment with `sequenceType="first"`); `createPortalSession` and `cancelSubscription` are not available because Mollie has no customer portal and requires a `customerId` that the plugin contract does not carry.',
    );
    r.uiHints({
      displayLabel: "Billing \u00b7 Mollie",
      category: "billing",
      recommended: false,
    });
    r.requires({ features: ["billing-foundation"] });
    r.envSchema(subscriptionMollieEnvSchema);

    const plugin: SubscriptionProviderPlugin = {
      verifyAndParseWebhook: verifyAndParse,
      createCheckoutSession: checkoutSession,
      // createPortalSession and cancelSubscription are intentionally omitted;
      // see plugin-methods.ts for why.
      priceToTier: options.priceToTier,
    };
    r.useExtension("subscriptionProvider", MOLLIE_PROVIDER_NAME, plugin);
  });
}
