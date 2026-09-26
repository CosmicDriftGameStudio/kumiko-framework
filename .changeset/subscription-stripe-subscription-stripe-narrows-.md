---
"@cosmicdrift/kumiko-bundled-features": patch
---

subscription-stripe narrows a recurring price interval to a closed union instead of widening on an unrecognized Stripe value

stripe >= 22.5 widened Recurring.Interval to an open union. mapStripePrice now maps anything outside RecurringInterval ("day" | "week" | "month" | "year") to null via isKnownRecurringInterval, the same as a one-off price, instead of letting an unrecognized interval leak into ProviderPrice untyped. stripe bumped to 22.6.2. Closes #3312.

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: subscription-stripe narrows a recurring price interval to a closed union instead of widening on an unrecognized Stripe value
-->
