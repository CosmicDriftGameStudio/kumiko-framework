// Public API of the subscription-stripe bundled feature.
//
// **Internal-only** (not in the public barrel — the App Builder never uses it directly):
//   - StripeWebhookOptions / verifyAndParseStripeWebhook (called internally by the
//     feature.ts factory)
//   - mapStripeEventType / mapStripeStatus (pure helpers, for tests only;
//     import directly from the file only if truly needed externally)

export {
  STRIPE_PROVIDER_NAME,
  StripeEventTypes,
  SUBSCRIPTION_STRIPE_FEATURE,
} from "./constants.ts";
export {
  createSubscriptionStripeFeature,
  type SubscriptionStripeOptions,
  stripeEnvSchema,
  subscriptionStripeEnvSchema,
} from "./feature.ts";
