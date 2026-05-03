// Public API of the subscription-stripe bundled-feature.
//
// **Internal-only** (NICHT im public-barrel — App-Builder nutzt das nie direkt):
//   - StripeWebhookOptions / verifyAndParseStripeWebhook (intern vom
//     feature.ts factory aufgerufen)
//   - mapStripeEventType / mapStripeStatus (pure helpers, test-only;
//     direct-import aus dem File wenn echt mal extern gebraucht)

export {
  STRIPE_PROVIDER_NAME,
  StripeEventTypes,
  SUBSCRIPTION_STRIPE_FEATURE,
} from "./constants";
export { createSubscriptionStripeFeature, type SubscriptionStripeOptions } from "./feature";
