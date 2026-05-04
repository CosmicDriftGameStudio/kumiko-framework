// Public API of the subscription-foundation bundled-feature.

export { subscriptionAggregateId } from "./aggregate-id";
export {
  BILLING_FOUNDATION_FEATURE,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  type SubscriptionEventType,
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "./constants";
export { subscriptionEntity } from "./entities";
export {
  INVOICE_PAID_EVENT_QN,
  INVOICE_PAID_EVENT_SHORT,
  INVOICE_PAYMENT_FAILED_EVENT_QN,
  INVOICE_PAYMENT_FAILED_EVENT_SHORT,
  SUBSCRIPTION_AGGREGATE_TYPE,
  SUBSCRIPTION_CANCELED_EVENT_QN,
  SUBSCRIPTION_CANCELED_EVENT_SHORT,
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_SHORT,
  SUBSCRIPTION_UPDATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_SHORT,
  type SubscriptionEventHeaders,
  type SubscriptionEventPayload,
  subscriptionEventPayloadSchema,
} from "./events";
export { subscriptionFoundationFeature } from "./feature";
export { getSubscriptionForTenant, type SubscriptionView } from "./get-subscription-for-tenant";
export { subscriptionsProjectionTable } from "./projection";
export type {
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "./types";
export {
  createSubscriptionWebhookHandler,
  type SubscriptionWebhookDeps,
  type SubscriptionWebhookHandler,
} from "./webhook-handler";
