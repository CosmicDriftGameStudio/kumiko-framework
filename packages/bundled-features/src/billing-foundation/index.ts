// Public API of the subscription-foundation bundled-feature.

export { paymentAggregateId, subscriptionAggregateId } from "./aggregate-id.js";
export {
  type BillingInfo,
  type BillingInfoQueryDeps,
  createBillingInfoQueryConfig,
} from "./billing-info-query.js";
export {
  isBillingEnabled,
  type ResolvedProvider,
  resolveProviderPlugin,
} from "./checkout-core.js";
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
  parseProviderConsentId,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  type SubscriptionCancelTiming,
  SubscriptionCancelTimings,
  type SubscriptionEventType,
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "./constants.js";
export {
  type ContractTerminationRoutesOptions,
  createContractTerminationRoutes,
} from "./consumer-protection/termination-pages.js";
export { paymentEntity, subscriptionEntity } from "./entities.js";
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
} from "./events.js";
export { billingFoundationFeature, createBillingFoundationFeature } from "./feature.js";
export { getSubscriptionForTenant, type SubscriptionView } from "./get-subscription-for-tenant.js";
export { paymentsProjectionTable, subscriptionsProjectionTable } from "./projection.js";
export { billingPlansPanel, createBillingPlansScreen } from "./screens.js";
export {
  createSubscriptionTierSync,
  effectiveTierFromSubscription,
  SUBSCRIPTION_WEBHOOK_PATH,
  type SubscriptionTierSyncDeps,
} from "./subscription-tier-sync.js";
export {
  type BillingFoundationOptions,
  type BillingPlanBenefit,
  type BillingPlanCatalog,
  type BillingPlanPrice,
  type BillingPlansResult,
  type BillingPlanView,
  type ConsumerProtectionOptions,
  KNOWN_RECURRING_INTERVALS,
  type PaymentEvent,
  type ProviderPrice,
  type ProviderSubscriptionSnapshot,
  type RecurringInterval,
  type SubscriptionEvent,
  type SubscriptionProviderPlugin,
} from "./types.js";
export {
  createSubscriptionWebhookRoute,
  type SubscriptionWebhookRouteOptions,
} from "./webhook-handler.js";
