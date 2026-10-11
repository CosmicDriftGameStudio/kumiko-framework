---
"@cosmicdrift/kumiko-bundled-features": minor
---

Delivery idempotencyKey is released when nothing was delivered

A retry of a failed notify() with the same idempotencyKey is no longer skipped as a duplicate. The key is deleted when no recipient got a `sent` or `queued` delivery, also when notify() throws; one successful recipient keeps it, even if notify() throws afterwards (a retry would re-send to them). For queued channels the send/render job deletes the key after its final failed attempt, not per retry. That reference is only attached when a `route` call has exactly one channel address; `to` calls (user lists) and multi-channel routes keep the key after queueing. The job payload gains an optional `idempotencyKey`, backward compatible. `createDeliveryTestContext` accepts `idempotencyRedis`.

<!-- kumiko-changes
feature: delivery
type: improvement
title: Delivery idempotencyKey is released when nothing was delivered
-->
