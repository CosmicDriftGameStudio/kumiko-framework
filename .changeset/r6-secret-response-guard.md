---
"@cosmicdrift/kumiko-framework": minor
---

Add the R6 compile-time secret-response guard. `defineWriteHandler` and `defineQueryHandler` now reject a `Secret<>`-branded value anywhere in a handler's inferred response type at compile time — the static twin of the existing `assertNoSecretLeak` runtime guard. Clean responses, including branded primitives (e.g. `TenantId`) and opaque leaves (`Temporal.*`, `Date`), are unaffected, and handlers generic over their response still compile (the guard is biased to defer to the runtime guard when it cannot prove a leak). Exposes the `ContainsSecret<T>` predicate from the secrets module.
