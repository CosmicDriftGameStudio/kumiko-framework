---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createDeliveryTestContext` now behaves like the production `ctx.notify`. It takes a `secrets` option for inline-delivered chat channels and passes the calling context's job dispatcher to `notify()` on every call. Queued channels now go through the delivery jobs when the stack has a job consumer (`jobs: { consumerLane: "worker" }`); call `stack.drainJobs()` before asserting on the result. With `jobs: {}` and no `consumerLane` the attempts stay queued and `drainJobs()` never finishes. Without `jobs` they still deliver inline.

New export `createDeliveryNotifyFactory(deliveryService, { deliverQueuedInline? })` builds this `NotifyFactory` for custom setups.

<!-- kumiko-changes
feature: delivery
type: improvement
title: createDeliveryTestContext matches production notify
-->
