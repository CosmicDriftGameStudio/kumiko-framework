---
"@cosmicdrift/kumiko-bundled-features": patch
---

`MolliePriceConfig.interval` is now optional so one-off prices (credit top-ups, `mode: "payment"`) no longer need a dummy interval. A price without `interval` booked as a subscription now fails at checkout creation, and a paid first payment for such a price creates no Mollie subscription (a warning is logged). The "checkout url is null" error no longer blames first-payment mandates for one-off payments.

<!-- kumiko-changes
feature: subscription-mollie
type: breaking
title: Mollie one-off prices no longer need an interval; a subscription price without one is rejected
migration: |
  Mollie checkout creation now throws for a subscription price without `interval`; set `interval` on every subscription price (one-off `mode: "payment"` prices need none).
-->
