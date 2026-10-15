---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

ctx.notify in write handlers delivers after commit

<!-- kumiko-changes
feature: framework
type: breaking
title: ctx.notify in write handlers delivers after commit
detail: Inside a write handler's transaction ctx.notify only records the notification and delivers it once the write has committed, so a rolled-back write sends nothing and leaves no attempt event. Delivery no longer takes a connection from the app pool while the write holds one, which deadlocked at pool max N with N parallel writes. With immediate: true the call stays synchronous and runs its DB work on the outside-transaction pool.
migration: |
  NotifyResult is now a union, NotifyDispatched ({ kind: "dispatched", deliveries }) or NotifyDeferred ({ kind: "deferred" }). In a write handler without immediate: true ctx.notify returns deferred and delivers after commit (a rollback means no notification). Code that reads the result (for example a "send test message" handler showing sent/failed) sets immediate: true, which delivers synchronously on the outside-transaction pool and returns dispatched; narrow on kind before reading deliveries. Errors such as a missing idempotency Redis, a tenant broadcast without the tenant feature or an unknown notification type no longer throw in a deferred write handler, they land in the afterCommit log. Notifications from jobs, from seeding and from handlers without a transaction stay synchronous. The boot default wires tenantUserIdsQuery for to: { tenant } when the tenant feature is mounted, so an app-side tenantUserIdsQuery wiring can go. Custom NotifyFactory implementations receive an optional 4th parameter deliveryDb, and DeliveryService.notify an optional 6th.
-->
