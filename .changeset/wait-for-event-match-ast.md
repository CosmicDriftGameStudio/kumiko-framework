---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

**Breaking:** `r.step.waitForEvent`'s `match` argument is now a serializable `EventMatch` AST (`{ version: 1, expr: ... }` built from `and`/`or`/`atom` nodes and `eq`/`ne`/`in`/`gt`/`gte`/`lt`/`lte` ops) instead of a `(payload: unknown) => boolean` closure. The resolved AST is persisted into the `workflow.step.waiting-for-event` suspension event's payload so the Resume-Loop can evaluate it (via the new `evaluateEventMatch` export) without re-running app code — a closure cannot survive that round-trip. No compatibility shim: any existing `match` closure must be rewritten as an `EventMatch` expression.
