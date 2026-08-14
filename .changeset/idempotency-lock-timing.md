---
"@cosmicdrift/kumiko-framework": patch
---

Fixes two idempotency-lock races that could let a duplicate request re-run a write handler or silently overwrite a fresher cached result. `waitTimeoutMs` (how long a duplicate request waits for the in-flight one) is now clamped to always exceed `pendingTtlSeconds` (the in-progress lock's own TTL) — previously the defaults (30s lock vs. 25s wait) let a retry give up and re-execute the handler while the original call was still legitimately running. `IdempotencyGuard.store()` now does an atomic compare-and-swap against the exact lock token the calling run acquired (Redis `EVAL`, mirroring the existing `distributed-lock.ts` pattern) instead of an unconditional `SET`, so a stale, slow-finishing run can no longer stomp the result a reclaiming run already persisted after the lock expired.

`IdempotencyGuard.check()` now returns a discriminated `{ status: "cached", result }` / `{ status: "acquired", token }` union instead of `string | null`, and `store()` takes the acquired `token` as a new fourth parameter. Both call sites in this package (`dispatch-batch.ts`, the dispatcher test mock) are updated; any code outside this repo calling `IdempotencyGuard` directly needs the same update.
