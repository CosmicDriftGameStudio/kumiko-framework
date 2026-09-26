---
"@cosmicdrift/kumiko-bundled-features": minor
---

subscription-stripe implements retrievePrices, createPlanSwitchSession and isBillingEnabled for the shared billing-plans catalog

Adds priceToTier (Stripe price id -> app tier name), a 10-minute TTL-cached retrievePrices for the billing-plans catalog, createPlanSwitchSession (auto-provisions a Stripe Customer-Portal configuration content-addressed by its price set, reusing an existing one via configurations.list() before calling configurations.create()) and isBillingEnabled (billingLive plus an api-key existence probe, no secret read). Each plan tier needs its own Stripe product: two allowed prices sharing a product+interval are rejected before any Stripe portal call.

<!-- kumiko-changes
feature: subscription-stripe
type: improvement
title: subscription-stripe implements retrievePrices, createPlanSwitchSession and isBillingEnabled for the shared billing-plans catalog
-->
