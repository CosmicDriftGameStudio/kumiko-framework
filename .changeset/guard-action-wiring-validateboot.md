---
"@cosmicdrift/kumiko-framework": minor
---

`validateBoot` now throws when `rowActions`/`toolbarActions` (`payload`/`params`/`entityId`/`visible`)
or `entityList`/`projectionList`/`entityEdit` column/field renderers hold a JS function instead of
the declarative DSL. Function values compile fine at the type level but are silently dropped by
`JSON.stringify` once the screen config reaches the client bundle, turning the action or renderer
into a silent no-op instead of a boot failure — this now fails loudly at boot time instead.

Partial migration of infra's `guard-action-wiring`/`guard-no-function-renderer` into the framework
(infra#133).
