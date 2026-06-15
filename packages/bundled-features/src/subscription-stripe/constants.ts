// Feature name
export const SUBSCRIPTION_STRIPE_FEATURE = "subscription-stripe" as const;

// entityName under den der Plugin gegen "subscriptionProvider"
// registriert. Matcht den path-segment in der webhook-URL
// `/api/subscription/webhook/stripe`.
export const STRIPE_PROVIDER_NAME = "stripe" as const;

// Config-key short-names, qualified to `subscription-stripe:config:<name>`
// at registry-build. api-key + webhook-secret declare backing:"secrets"
// (value lives envelope-encrypted in the secrets store under SYSTEM_TENANT_ID)
// but are addressed as config keys; billingLive is a plain system config flag.
export const STRIPE_API_KEY_CONFIG = "api-key" as const;
export const STRIPE_WEBHOOK_SECRET_CONFIG = "webhook-secret" as const;
export const STRIPE_BILLING_LIVE_CONFIG = "billingLive" as const;

// =============================================================================
// Stripe-event-types die wir auf normalisierte SubscriptionEventTypes
// mappen. Stripe hat ~80 event-types insgesamt; wir filtern auf 5.
// =============================================================================

export const StripeEventTypes = {
  customerSubscriptionCreated: "customer.subscription.created",
  customerSubscriptionUpdated: "customer.subscription.updated",
  customerSubscriptionDeleted: "customer.subscription.deleted",
  invoicePaid: "invoice.paid",
  invoicePaymentFailed: "invoice.payment_failed",
} as const;
