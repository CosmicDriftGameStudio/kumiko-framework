---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createDeliveryTestContext` now behaves like the production `ctx.notify`. It takes a `secrets` option for inline-delivered chat channels and passes the calling context's job dispatcher to `notify()` on every call. Tests that set up `jobs` now deliver queued channels through the delivery jobs, so call `stack.drainJobs()` before asserting on the result. Without a job runner they still deliver inline.

New export `createDeliveryNotifyFactory(deliveryService, { deliverQueuedInline? })` builds this `NotifyFactory` for custom setups.

<!-- kumiko-changes
feature: delivery
type: improvement
title: createDeliveryTestContext matches production notify
-->
