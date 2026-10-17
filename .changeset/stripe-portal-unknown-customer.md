---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Stripe customer portal reports an unknown customer as a business error

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: A stale Stripe customer id no longer turns the customer portal into a 500
detail: createPortalSession now maps Stripe's "No such customer" rejection (account switch, customer deleted in the dashboard) to an UnprocessableError with the i18n key billing-foundation.errors.providerCustomerUnknown, translated in German and Spanish, instead of letting the raw Stripe error surface as a server error.
-->
