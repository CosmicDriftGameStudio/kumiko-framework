---
"@cosmicdrift/kumiko-framework": minor
---

A write, batch or command retry with the same `requestId` no longer replays a cached 500 for 300s after a rolled-back transient server error (e.g. a closed Postgres connection). The dispatcher releases the idempotency lock instead, so the retry re-runs the write. A deterministic 4xx rejection still returns the identical cached response, and a failure during COMMIT (outcome unknown) stays cached rather than risk running an already-applied write twice.

Because the retry re-runs, non-transactional side effects of the failed attempt (writes through `ctx.dbOutsideTransaction`, external calls made inside the handler) run again.

`IdempotencyGuard` has a new required method `release(tenantId, userId, requestId, token)` that frees the in-progress lock (token-guarded, like `store`) instead of persisting a result.

<!-- kumiko-changes
feature: framework
type: breaking
title: Idempotent retries re-run after a rolled-back 5xx instead of replaying it
migration: |
  Custom IdempotencyGuard implementations must add release(tenantId, userId, requestId, token), which deletes the pending lock only if it still holds that token
-->
