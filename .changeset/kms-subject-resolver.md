---
"@cosmicdrift/kumiko-framework": minor
---

Crypto-shredding phase B — subject resolver + request DEK cache (#724): `resolveSubjectForField` maps a pii-annotated field to its erase subject (`userOwned` owner ref > `tenantOwned` row/write-time tenant > `pii` self); an annotated field whose row cannot name its subject throws `SubjectResolutionError` instead of silently staying plaintext. `collectPiiSubjectFields` precomputes the encrypt-relevant field set per entity. `createRequestKmsCache` caches unwrapped DEKs per request for local-key adapters, with `invalidate()` as the subject-forgotten hook.
