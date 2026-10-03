---
"@cosmicdrift/kumiko-bundled-features": minor
---

The billing provider contract carries what consumer-protection checkout needs. `cancelSubscription` now takes `{ providerSubscriptionId, when }`, where `when` is `"period-end"` or `"immediately"`. `createCheckoutSession` accepts `consentId`, `locale` and `submitMessage`. Webhook events (`SubscriptionEvent`, `PaymentEvent`) echo an optional `consentId`, and `billing-foundation` stores it on the subscription and payment events. Stripe checkout always sets `submit_type: "pay"`, maps the app locale to a Stripe checkout locale and shows `submitMessage` next to the submit button.

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: SubscriptionProviderPlugin.cancelSubscription takes { providerSubscriptionId, when }
detail: |
  `cancelSubscription(ctx, { providerSubscriptionId, when })` replaces the positional `providerSubscriptionId` argument. `when` is `SubscriptionCancelTimings.periodEnd` (`"period-end"`, the subscription runs to the end of the paid period) or `SubscriptionCancelTimings.immediately` (`"immediately"`). `createCheckoutSession` options gain optional `consentId`, `locale` and `submitMessage`; `SubscriptionEvent` and `PaymentEvent` gain an optional `consentId`, validated by `parseProviderConsentId` (max 100 characters of `A-Z a-z 0-9 _ -`), and `subscription` / `payment` event payloads store it.
migration: |
  Custom provider plugins that implement `cancelSubscription` change the signature to `(ctx, { providerSubscriptionId, when })` and honor `when`. A provider that can only cancel immediately may treat both values the same or leave the method out. Callers pass `{ providerSubscriptionId, when: SubscriptionCancelTimings.immediately }` to keep the old behavior.
-->

<!-- kumiko-changes
feature: subscription-stripe
type: improvement
title: Stripe checkout sets submit_type, locale, submit text and consentId; cancel can run to period end
detail: |
  Checkout sessions in both modes set `submit_type: "pay"`. `locale` maps to a Stripe checkout locale (exact match, else the language part such as `de-AT` to `de`, else `"auto"`), and `submitMessage` becomes `custom_text.submit.message` (capped at Stripe's 1200 characters). `consentId` is written to `subscription_data.metadata` or `payment_intent_data.metadata` next to `tenantId` and read back from the same place on the webhook. `cancelSubscription` with `when: "period-end"` sets `cancel_at_period_end`; `"immediately"` cancels the subscription.
migration: |
  No code change needed.
-->

<!-- kumiko-changes
feature: subscription-mollie
type: improvement
title: Mollie checkout carries consentId through payment and subscription metadata
detail: |
  `consentId` from the checkout options is stored in the first payment's metadata, copied onto the subscription created from it, and returned as `SubscriptionEvent.consentId` when valid. `cancelSubscription` stays unimplemented for Mollie.
migration: |
  No code change needed.
-->
