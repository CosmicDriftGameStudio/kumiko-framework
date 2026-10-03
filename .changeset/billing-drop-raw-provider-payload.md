---
"@cosmicdrift/kumiko-bundled-features": minor
---

Billing no longer stores the raw provider event. Stripe and Mollie webhooks used to archive the whole provider payload as `rawPayload` in the event headers, which carries customer PII (email, name, address, phone, custom fields) in a place that is not crypto-shreddable. The field is gone from `SubscriptionEvent`, `PaymentEvent`, `ProviderSubscriptionSnapshot`, the `process-event` / `process-payment-event` payloads and the stored event headers. Idempotency still uses `providerEventId` plus `providerName`.

Consumers that parsed `rawPayload` for the Stripe checkout session id read `headers.providerCheckoutId` of the `payment-received` event instead. `PaymentEvent` and the `process-payment-event` payload carry an optional `providerCheckoutId`, which the Stripe plugin sets to the checkout session id; Mollie does not produce payment events.

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: Remove rawPayload from provider events and event headers
detail: |
  `rawPayload` is removed from `SubscriptionEvent`, `PaymentEvent`, `ProviderSubscriptionSnapshot`, the `process-event` and `process-payment-event` schemas and `SubscriptionEventHeaders` / `PaymentEventHeaders`. New events carry `providerEventId` and `providerName` in their headers; payment events also carry the optional `providerCheckoutId` (Stripe checkout session id).
migration: |
  Custom subscription provider plugins must stop returning `rawPayload`; TypeScript flags the removed field. Code that read the checkout session id out of `headers.rawPayload` reads `headers.providerCheckoutId` instead. Events already stored keep their old `rawPayload` header; this release does not rewrite stored events.
-->

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: Stripe webhooks no longer archive the full provider event
detail: |
  Subscription and one-off-payment events parsed from Stripe webhooks, and the snapshot returned by sync-subscriptions, no longer include the serialized Stripe event, so customer details never land in the event store.
-->

<!-- kumiko-changes
feature: subscription-mollie
type: fix
title: Mollie webhooks no longer archive the subscription and payment objects
detail: |
  Subscription events parsed from Mollie webhooks no longer include the serialized subscription and trigger payment, which can carry consumer name and account data.
-->
