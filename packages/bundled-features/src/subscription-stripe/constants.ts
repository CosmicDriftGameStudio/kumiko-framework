// Feature name
export const SUBSCRIPTION_STRIPE_FEATURE = "subscription-stripe" as const;

// entityName under which the plugin registers itself as
// "subscriptionProvider". It must match the path segment in the webhook URL
// `/api/subscription/webhook/stripe`.
export const STRIPE_PROVIDER_NAME = "stripe" as const;

// Config-key short-names, qualified to `subscription-stripe:config:<name>`
// at registry-build. api-key + webhook-secret declare backing:"secrets"
// (value lives envelope-encrypted in the secrets store under SYSTEM_TENANT_ID)
// but are addressed as config keys; billingLive is a plain system config flag.
export const STRIPE_API_KEY_CONFIG = "api-key" as const;
export const STRIPE_WEBHOOK_SECRET_CONFIG = "webhook-secret" as const;
export const STRIPE_BILLING_LIVE_CONFIG = "billingLive" as const;

// Stripe event types that map to normalized SubscriptionEventTypes.
// Stripe has approximately 80 event types; we filter to five.

export const StripeEventTypes = {
  customerSubscriptionCreated: "customer.subscription.created",
  customerSubscriptionUpdated: "customer.subscription.updated",
  customerSubscriptionDeleted: "customer.subscription.deleted",
  invoicePaid: "invoice.paid",
  invoicePaymentFailed: "invoice.payment_failed",
  // One-off-payment checkout (mode: "payment") completion. Both fire for a
  // successful payment — `completed` for synchronous methods (card),
  // `async_payment_succeeded` for delayed ones (SEPA, bank transfers). Never
  // fed into mapStripeEventType — handled by a dedicated branch in
  // verify-webhook.ts before the subscription-event switch runs.
  checkoutSessionCompleted: "checkout.session.completed",
  checkoutSessionAsyncPaymentSucceeded: "checkout.session.async_payment_succeeded",
} as const;
