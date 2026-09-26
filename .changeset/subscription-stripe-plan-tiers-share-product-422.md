---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

subscription-stripe's switch-plan returns a 422 instead of a bare 500 when two plan tiers share one Stripe product

`createStripePlanSwitchSession`'s pre-check (two allowed prices at the same product+interval) and a matching Stripe Customer-Portal `StripeInvalidRequestError` (from `configurations.create()` or `sessions.create()`) both now throw `UnprocessableError('plan_tiers_share_product')` with i18nKey `billing-foundation.errors.planTiersShareProduct`, so the caller gets an actionable 422 instead of an opaque 500. Every other Stripe error keeps its existing mapping; the portal-configuration cache is still evicted on a `sessions.create()` failure.

Each plan tier needs its own Stripe product: the Customer Portal configuration allows only one price per product and interval, so tiers that share a product cannot be switched between.

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: switch-plan returns a 422 instead of a 500 when two plan tiers share one Stripe product
-->
