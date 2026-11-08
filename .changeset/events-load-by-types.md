---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

`ctx.events.loadByTypes({ aggregateIds, eventTypes, includeArchived? })` reads the events of several aggregates filtered by event type in one tenant-scoped, upcasted query, in handlers and jobs, instead of one `ctx.events.load` per aggregate.

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.events.loadByTypes reads several aggregates by event type in one query
detail: `ctx.events.loadByTypes({ aggregateIds, eventTypes, includeArchived })` returns the matching events of all given aggregates in append order, upcasted, and leaves out archived streams unless `includeArchived` is set. Use it for list pages that need only a few event types of many aggregates.
-->
