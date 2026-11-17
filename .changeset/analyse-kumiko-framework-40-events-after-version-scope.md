---
"@cosmicdrift/kumiko-framework": patch
---

`loadEventsAfterVersion` reads in the event stream's tenant scope like the other stream reads.

<!-- kumiko-changes
feature: framework
type: fix
title: Snapshot delta read runs in the tenant scope
detail: `loadEventsAfterVersion`, which `loadAggregateWithSnapshot` uses for the events after a snapshot, was the only stream read that did not set the tenant row-level security scope itself. Under the application role without an outer scope it returned no events. It now wraps its query in the same scope as `loadAggregate`.
-->
