---
"@cosmicdrift/kumiko-bundled-features": minor
---

subscription-stripe mode:"payment" checkouts now get a Stripe invoice by default

<!-- kumiko-changes
feature: subscription-stripe
type: breaking
title: subscription-stripe mode:"payment" checkouts now get a Stripe invoice by default
detail: |
  createCheckoutSession's mode:"payment" call (one-off top-ups etc.) never
  passed invoice_creation, so Stripe never generated an invoice document for
  those payments. It now defaults to `invoice_creation: { enabled: true }`
  for mode:"payment" — mode:"subscription" is unaffected, Stripe rejects
  invoice_creation there. Stripe Invoicing charges a per-invoice fee on top
  of the payment itself, so an existing high-volume, low-value payment flow
  may see new fees appear.
migration: |
  Pass `createSubscriptionStripeFeature({ paymentInvoiceCreation: false })`
  to opt out and keep the old no-invoice behaviour for mode:"payment" checkouts.
-->
