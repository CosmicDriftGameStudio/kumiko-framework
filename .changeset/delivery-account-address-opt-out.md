---
"@cosmicdrift/kumiko-bundled-features": patch
---

delivery honors an address opt-out on sends to a user account

<!-- kumiko-changes
feature: delivery
type: fix
title: delivery honors an address opt-out on sends to a user account
detail: |
  `deliverToUser` only checked the user's notification preferences, so an
  address that had been opted out via an address unsubscribe token still got
  mail once it belonged to a user account. It now runs the same check
  `deliverDirect` already applied: when the resolved channel address has a
  `notification-address-opt-out` row for that tenant, notificationType and
  channel, the attempt is logged as `skipped` / `unsubscribed` with
  `recipientAddress: null`. Critical priority still bypasses it
  (kumiko-framework#3275).
-->
