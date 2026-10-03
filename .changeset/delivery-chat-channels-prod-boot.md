---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Chat channels (slack, discord, teams, telegram) now deliver in production boot. `runProdApp`, `runDevApp` and `runWorkerApp` pass the tenant secrets to the delivery service and hand queued channels to the `delivery.render`/`delivery.send` jobs of the calling context's job runner. `delivery.render` now receives `ctx.secrets` as well. Without a job runner, queued channels still deliver inline, now with secrets. `runBootstrap` is a one-shot process whose queue nobody drains after it exits, so it keeps delivering queued channels inline (the SystemAdmin invitation goes out before the process ends).

`NotifyFn` returns a `NotifyResult` (`{ deliveries }` with channel, recipientId, status `queued | sent | failed | skipped`, error and `deliveryAttemptId` per delivery) instead of `void`. `NotifyOptions.immediate` delivers queued channels inline for one call and bypasses job retry, for "send test message" handlers. `NotifyFactory` takes an optional job dispatcher as third argument, and `DeliveryService.notify` an optional per-call dispatcher.

Consumers: `NotifyFn` implementations in tests and mocks must now return a `NotifyResult`, e.g. `async () => ({ deliveries: [] })`. When running the API without a worker (`runSingleInstance: false`), a dedicated worker must process the delivery jobs.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Chat channels deliver in production boot, ctx.notify returns a NotifyResult
migration: |
  NotifyFn implementations in tests and mocks must return a NotifyResult, e.g. async () => ({ deliveries: [] }). Queued channels now run through the delivery jobs in production; an API-only deployment (runSingleInstance: false) needs a worker that mounts delivery and the channel features.
-->
