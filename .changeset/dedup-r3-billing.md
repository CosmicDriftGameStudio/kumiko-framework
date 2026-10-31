---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Stripe and Paddle share their price-id validation, stored-secret parsing and price cache through billing-foundation, and the framework utils gain chunk.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Provider helpers shared through billing-foundation
detail: billing-foundation exports validateOneOffPriceIds, parseStoredSecret, createTtlPriceCache and hasSeenProviderEvent. subscription-stripe and subscription-paddle use them instead of their own copies, with the same error texts as before. The subscription projection reuses one apply body for created/updated and one for canceled/invoice-paid; the exported apply names stay.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: chunk in framework utils
detail: @cosmicdrift/kumiko-framework/utils exports chunk(items, size), which splits an array into slices of at most size elements. files-tenant-data, subscription-paddle and template-resolver use it instead of local copies.
-->
