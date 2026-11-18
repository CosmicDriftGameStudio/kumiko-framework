---
"@cosmicdrift/kumiko-framework": patch
---

The request idempotency lock stays held while a write batch runs, so a retry with the same request id no longer runs a handler twice after 30 seconds.

<!-- kumiko-changes
feature: framework
type: fix
title: Idempotency lock is renewed while the handler runs
detail: The pending idempotency lock had a fixed 30 second TTL. A write batch running longer than that let a retry with the same request id acquire the lock and execute the handler a second time. The dispatcher now renews the lock (compare-and-set on its token) every third of the TTL until the batch ends, on every exit path including thrown errors; after a crash it still expires on its TTL. A retry that waits longer than the guard's wait timeout now fails with the existing lock-contention error instead of running the handler again. `IdempotencyGuard` has a new method `keepPendingAlive`; custom implementations of the type must add it.
migration: Custom implementations of `IdempotencyGuard` add the method `keepPendingAlive`.
-->
