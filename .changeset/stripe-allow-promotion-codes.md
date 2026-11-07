---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createSubscriptionStripeFeature({ allowPromotionCodes: true })` shows Stripe's promotion-code field in checkout.

<!-- kumiko-changes
feature: subscription-stripe
type: improvement
title: Stripe checkout can accept promotion codes
detail: The new option `allowPromotionCodes` sets `allow_promotion_codes` on every Checkout Session of the app, in subscription and payment mode. Coupons and promotion codes are created in the Stripe dashboard. Default false, so existing checkouts show no code field.
-->
