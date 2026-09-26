---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

billing-foundation's checkout gate no longer blocks forever on a stale `incomplete` subscription

`modified_at`/`inserted_at` now track every subscription-projection upsert (using the appended event's own `createdAt`, not `now()`, so a rebuild stays deterministic). `getSubscriptionForTenant` exposes this as `SubscriptionView.lastChangedAt`. `isSubscriptionBlockingCheckout` treats an `incomplete` subscription older than 24h (Stripe's own auto-expiry window) as terminal, so a tenant whose checkout was abandoned can start a fresh one instead of getting stuck behind `ConflictError('subscriptionExists')` forever. A young `incomplete` subscription for a plan tier now shows `BillingPlanActions.paymentPending` on the billing-plans query, and the panel shows a "still completing" hint instead of a CTA for it. `createBillingFoundationFeature` gained an optional `now` clock option (defaults to real time), threaded through the checkout/plan-catalog handlers so tests can control staleness.

Known limit: two checkouts started in parallel before the provider's first webhook arrives can still create two subscriptions, since the gate only sees subscriptions already projected.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: billing-foundation's checkout gate no longer blocks forever on a stale incomplete subscription
detail: |
  A stale `incomplete` subscription (older than 24h) no longer counts as an active subscription for the checkout gate, so a tenant whose Stripe checkout was abandoned can start a fresh one. `SubscriptionView.lastChangedAt` (required) and `BillingPlanActions.paymentPending` are new; a consumer with an exhaustive switch over `BillingPlanAction` needs a `paymentPending` case. Known limit: two checkouts started in parallel before the provider's first webhook arrives can still create two subscriptions, since the gate only sees subscriptions already projected.
-->
