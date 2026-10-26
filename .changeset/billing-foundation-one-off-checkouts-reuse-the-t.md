---
"@cosmicdrift/kumiko-bundled-features": minor
---

One-off checkouts reuse the tenant's provider customer

create-checkout-session with mode payment and no providerCustomerId now passes the customer id of the tenant's own subscription at the same provider, so Stripe also receives the customer on one-off checkouts. The foreign-customer guard still applies.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: One-off checkouts reuse the tenant's provider customer
-->
