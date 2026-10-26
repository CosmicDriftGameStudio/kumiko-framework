---
"@cosmicdrift/kumiko-bundled-features": minor
---

authorizeOneOffCheckout hook gates one-off checkouts per tenant

BillingFoundationOptions.authorizeOneOffCheckout runs before every one-off (mode payment) checkout, after the oneOffPriceIds gate and before any provider call. A rejection becomes an UnprocessableError with the hook's reason as code. Without the hook the behavior is unchanged.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: authorizeOneOffCheckout hook gates one-off checkouts per tenant
-->
