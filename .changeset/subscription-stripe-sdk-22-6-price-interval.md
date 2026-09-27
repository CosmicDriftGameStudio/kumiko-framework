---
"@cosmicdrift/kumiko-bundled-features": patch
---

subscription-stripe bumps the stripe SDK to ^22.6.2 and fixes the resulting price-interval type break

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: subscription-stripe bumps the stripe SDK to ^22.6.2 and fixes the resulting price-interval type break
detail: |
  The bundled `stripe` dependency moves from ^22.1.1 to ^22.6.2.
  Stripe.Price.Recurring.Interval widened in that range; mapStripePrice
  now narrows it against the exported `KNOWN_RECURRING_INTERVALS` /
  `RecurringInterval` from billing-foundation instead of a cast (an
  unrecognized interval maps to `null`). Apps pinning their own
  `stripe` override for this mismatch can remove it.

  The plugin gains a new `oneOffPriceIds` option (validated at mount
  time — an empty-string or duplicate entry throws) and now maps Stripe's
  `subscription.cancel_at` (or `current_period_end` when only
  `cancel_at_period_end` is set) into the `cancelAtIso` event field
  billing-foundation's process-event consumes.
-->
