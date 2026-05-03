// Public API of the subscription-foundation bundled-feature.

export {
  subscriptionAggregateId,
  subscriptionEventAggregateId,
} from "./aggregate-id";
export {
  SUBSCRIPTION_FOUNDATION_FEATURE,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  type SubscriptionEventType,
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "./constants";
export { subscriptionEntity, subscriptionEventEntity } from "./entities";
export { subscriptionFoundationFeature } from "./feature";
export type {
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "./types";
export {
  createSubscriptionWebhookHandler,
  type SubscriptionWebhookDeps,
  type SubscriptionWebhookHandler,
} from "./webhook-handler";
