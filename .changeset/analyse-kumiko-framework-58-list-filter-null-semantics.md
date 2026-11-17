---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

`ListFilterOption` is exported and documents that `eq`/`ne` with `null` filter on IS NULL / IS NOT NULL.

<!-- kumiko-changes
feature: event-store
type: improvement
title: Executor list filters share one exported ListFilterOption type
detail: `ListFilterOption` from `@cosmicdrift/kumiko-types/event-store-executor-types` is now the single type of `filter` and `filters` in `EventStoreExecutor.list` and `aggregate`. Its doc states what already held: `{ op: "eq", value: null }` matches rows where the field is unset (IS NULL), `{ op: "ne", value: null }` rows where it is set (IS NOT NULL). Filters are AND-joined; there is no OR and no exists filter. Apps that drop `== null` rows in JS after a list call can move that test into the filter.
-->
