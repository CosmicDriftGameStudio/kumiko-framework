// Feature name
export const SUBSCRIPTION_STRIPE_FEATURE = "subscription-stripe" as const;

// entityName under den der Plugin gegen "subscriptionProvider"
// registriert. Matcht den path-segment in der webhook-URL
// `/api/subscription/webhook/stripe`.
export const STRIPE_PROVIDER_NAME = "stripe" as const;

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
