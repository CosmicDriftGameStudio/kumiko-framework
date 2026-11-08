---
"@cosmicdrift/kumiko-server-runtime": minor
---

`runProdApp({ billing: { stripe: { allowPromotionCodes: true } } })` passes the option on to `subscription-stripe`.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: The billing boot option forwards allowPromotionCodes
detail: `billing.stripe.allowPromotionCodes` reaches `createSubscriptionStripeFeature`, so an app booted through `runProdApp` or `runWorkerApp` can show Stripe's promotion-code field in checkout. Default false.
-->
