---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

`loadAggregate` and `ctx.fetchForWriting` gain an optional `aggregateType` stream filter, plus `handle.hasEvent(...)`

`loadAggregate(db, aggregateId, tenantId, options)` accepts an optional `options.aggregateType`. Without it, behavior is unchanged — every event on the aggregateId's stream is returned, same as today. With it, only events matching that `aggregateType` are returned, so two features that happen to share an `aggregateId` (e.g. reusing an upstream id as the key for a second, unrelated aggregate type) no longer leak each other's events into a business-rule check that only expected its own type.

`ctx.fetchForWriting({ aggregateId, aggregateType, ... })` now passes `aggregateType` through to `loadAggregate`, so `handle.events` is scoped the same way. The returned `AggregateStreamHandle` also gains `hasEvent(type: string): boolean`, an idempotency check against the fetch-time `events` snapshot — cheaper and safer than an `appendIfAbsent`-style helper, which risks masking a genuine optimistic-concurrency conflict as an already-applied write.

<!-- kumiko-changes
feature: framework
type: improvement
title: loadAggregate and ctx.fetchForWriting gain an optional aggregateType filter, plus handle.hasEvent(...)
migration: |
  No action required — purely additive. Every existing loadAggregate/fetchForWriting
  call keeps its current behavior; opt into the aggregateType filter only where an
  aggregateId is shared across more than one aggregate type.
-->
