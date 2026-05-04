// Public API of the subscription-mollie bundled-feature.
//
// **Internal-only** (NICHT im public-barrel — App-Builder nutzt das nie direkt):
//   - verifyAndParseMollieWebhook (intern vom feature.ts factory aufgerufen)
//   - mapMollieEventType / mapMollieStatus / extractMollieId (pure helpers,
//     test-only — direct-import aus dem File wenn echt mal extern gebraucht)

export { MOLLIE_PROVIDER_NAME, SUBSCRIPTION_MOLLIE_FEATURE } from "./constants";
export {
  createSubscriptionMollieFeature,
  type SubscriptionMollieOptions,
} from "./feature";
export type { MolliePriceConfig } from "./plugin-methods";
