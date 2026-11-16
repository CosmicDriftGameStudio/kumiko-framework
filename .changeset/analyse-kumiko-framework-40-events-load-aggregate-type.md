---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

`ctx.events.load` takes `aggregateType` to leave out events of another aggregate type that shares the id.

<!-- kumiko-changes
feature: event-store
type: improvement
title: ctx.events.load can filter by aggregate type
detail: Two aggregate types may use the same aggregate id, and `ctx.events.load(id)` then returned the events of both. `ctx.events.load(id, { aggregateType })` keeps only that type's events, also together with `asOf`, in handlers and jobs. `loadAggregateAsOf` takes the same `aggregateType` option as `loadAggregate`, and an empty string throws instead of loading every type. Without the option nothing changes.
-->
