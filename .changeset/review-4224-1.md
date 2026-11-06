---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

The delivery attempt log factory is boot wiring and no longer reaches `ctx.services`.

<!-- kumiko-changes
feature: framework
type: fix
title: Handlers can no longer call the unbound delivery attempt log factory
detail: `_deliveryAttemptLogFactory` was copied into `ctx.services`, so a handler could log delivery attempts for any tenant and recipient. It is now wiring; handlers keep the bound `_logOwnDeliveryAttempt`.
-->
