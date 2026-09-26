// Public API of the subscription-foundation bundled-feature.

export { paymentAggregateId, subscriptionAggregateId } from "./aggregate-id";
export {
  type BillingInfo,
  type BillingInfoQueryDeps,
  createBillingInfoQueryConfig,
} from "./billing-info-query";
export {
  BILLING_FOUNDATION_FEATURE,
  BILLING_PLANS_PANEL_COMPONENT,
  BILLING_PLANS_SCREEN_ID,
  type BillingEventKind,
  BillingEventKinds,
  type BillingPlanAction,
  BillingPlanActions,
  DEFAULT_PURCHASE_ROLES,
  isSwitchableSubscriptionStatus,
  isTerminalSubscriptionStatus,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  type SubscriptionEventType,
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "./constants";
export { paymentEntity, subscriptionEntity } from "./entities";
export {
  INVOICE_PAID_EVENT_QN,
  INVOICE_PAID_EVENT_SHORT,
  INVOICE_PAYMENT_FAILED_EVENT_QN,
  INVOICE_PAYMENT_FAILED_EVENT_SHORT,
  PAYMENT_AGGREGATE_TYPE,
  PAYMENT_RECEIVED_EVENT_QN,
  PAYMENT_RECEIVED_EVENT_SHORT,
  type PaymentEventHeaders,
  type PaymentEventPayload,
  paymentEventPayloadSchema,
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
export { billingFoundationFeature, createBillingFoundationFeature } from "./feature";
export { getSubscriptionForTenant, type SubscriptionView } from "./get-subscription-for-tenant";
export { paymentsProjectionTable, subscriptionsProjectionTable } from "./projection";
export { billingPlansPanel, createBillingPlansScreen } from "./screens";
export {
  createSubscriptionTierSync,
  effectiveTierFromSubscription,
  SUBSCRIPTION_WEBHOOK_PATH,
  type SubscriptionTierSyncDeps,
} from "./subscription-tier-sync";
export type {
  BillingFoundationOptions,
  BillingPlanBenefit,
  BillingPlanCatalog,
  BillingPlanPrice,
  BillingPlansResult,
  BillingPlanView,
  PaymentEvent,
  ProviderPrice,
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "./types";
export {
  createSubscriptionWebhookRoute,
  type SubscriptionWebhookRouteOptions,
} from "./webhook-handler";
