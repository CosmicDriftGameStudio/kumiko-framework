---
"@cosmicdrift/kumiko-bundled-features": patch
---

Stripe subscription status incomplete_expired now maps to canceled instead of incomplete

incomplete_expired means Stripe abandoned the subscription's first payment for good (unlike a live incomplete, which is still retryable). Mapping it to canceled instead of incomplete lets the tenant start a fresh checkout instead of being blocked by openCheckout's subscription-already-exists conflict.

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: Stripe subscription status incomplete_expired now maps to canceled instead of incomplete
-->
