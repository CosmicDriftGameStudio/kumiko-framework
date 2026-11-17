---
"@cosmicdrift/kumiko-framework": patch
---

The Redis idempotency, event-dedup and distributed-lock integration tests observe TTLs instead of sleeping a fixed time.

<!-- kumiko-changes
feature: framework
type: fix
title: Redis TTL integration tests observe expiry and renewal instead of fixed sleeps
detail: redis-pipeline.integration.test.ts and distributed-lock.integration.test.ts no longer wait with fixed sleeps of 1100 to 2500 ms. They check the key's PTTL right after the write, poll the raw key until Redis reports it gone (bounded at 3 s), and count heartbeat renewals as upward PTTL jumps. Renew tests assert the extended PTTL directly (4000 to 5000 ms for a 5 s renew, at most 1000 ms after a wrong-token renew). Test-only change, no runtime behavior changes.
-->
