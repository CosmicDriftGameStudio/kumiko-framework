---
"@cosmicdrift/kumiko-bundled-features": minor
---

`DerivativePublicPredicateArgs` (the argument passed to a `file-derivatives` entityType's `isPublic` predicate) now additionally carries `fieldName` and `variant`, so an app can opt individual fields/variants out of public serving instead of every declared variant becoming implicitly public once the entityType-level check returns `true` — additive, non-breaking: existing `({entityId, tenantId}) => boolean` predicates stay assignable. `DerivativePublicPredicateArgs`/`DerivativePublicPredicatePlugin` are now also re-exported from the `file-derivatives` package entrypoint. Separately, `publicVariantQuery`'s `fileRefId` is now UUID-validated by the handler's own schema (not only by the httpRoute wrapper's pre-check), closing a path where a malformed id reached the DB via the generic `/api/query` dispatch.
