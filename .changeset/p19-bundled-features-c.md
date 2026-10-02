---
"@cosmicdrift/kumiko-bundled-features": patch
---

The Stripe plan switch now fails with `price_unavailable` when an allowed price cannot be retrieved, instead of creating an incomplete Stripe portal configuration under a different price-set hash. A concurrent losing `request-deletion` now reports the user's current status in `user_not_in_active_state` instead of the stale `active`.

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: plan switch rejects unretrievable prices, concurrent request-deletion loser reports the fresh user status
-->
