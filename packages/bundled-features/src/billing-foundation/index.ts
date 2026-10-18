// Public API of the subscription-foundation bundled-feature.

export { paymentAggregateId, subscriptionAggregateId } from "./aggregate-id.ts";
export {
  type BillingInfo,
  type BillingInfoQueryDeps,
  createBillingInfoQueryConfig,
} from "./billing-info-query.ts";
export {
  isBillingEnabled,
  type ResolvedProvider,
  resolveProviderPlugin,
} from "./checkout-core.ts";
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
} from "./constants.ts";
export {
  type ConsentPayload,
  consentPayloadSchema,
  type OrderItem,
} from "./consumer-protection/consent-gate.ts";
export {
  CONSENT_LOCALES,
  type ConsentLocale,
  resolveConsentLocale,
} from "./consumer-protection/consent-locale.ts";
export {
  type ContractTerminationRoutesOptions,
  createContractTerminationRoutes,
} from "./consumer-protection/termination-pages.ts";
export { paymentEntity, subscriptionEntity } from "./entities.ts";
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
} from "./events.ts";
export { createBillingFoundationFeature } from "./feature.ts";
export { getSubscriptionForTenant, type SubscriptionView } from "./get-subscription-for-tenant.ts";
export { paymentsProjectionTable, subscriptionsProjectionTable } from "./projection.ts";
export { billingPlansPanel, createBillingPlansScreen } from "./screens.ts";
export {
  createSubscriptionTierSync,
  effectiveTierFromSubscription,
  SUBSCRIPTION_WEBHOOK_PATH,
  type SubscriptionTierSyncDeps,
} from "./subscription-tier-sync.ts";
export {
  type BillingFoundationOptions,
  type BillingPlanBenefit,
  type BillingPlanCatalog,
  type BillingPlanPrice,
  type BillingPlansResult,
  type BillingPlanView,
  type ConsumerProtectionOptions,
  KNOWN_RECURRING_INTERVALS,
  type LegalLinkSet,
  type PaymentEvent,
  type ProviderPrice,
  type ProviderSubscriptionSnapshot,
  type RecurringInterval,
  type SubscriptionEvent,
  type SubscriptionProviderPlugin,
} from "./types.ts";
export {
  createSubscriptionWebhookRoute,
  type SubscriptionWebhookRouteOptions,
} from "./webhook-handler.ts";
