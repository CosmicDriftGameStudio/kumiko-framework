---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

`EventMetadata` gains an optional `idempotencyKey`. When set, `append()` enforces it via a tenant-scoped partial unique index (`metadata->>'idempotencyKey'`) and throws the new `IdempotentAppendConflictError` on a repeat — a second line of defense against duplicate appends when the Redis-backed HTTP idempotency guard misses a retry window. Opt-in only; existing callers are unaffected.
