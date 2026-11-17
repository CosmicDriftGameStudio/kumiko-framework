---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`executor.listAsOf` takes an optional `ids` list and folds only those aggregates.

<!-- kumiko-changes
feature: event-store
type: improvement
title: listAsOf filters by aggregate ids
detail: `executor.listAsOf({ asOf, ids })` loads only the named aggregates' events up to `asOf`, filtered in SQL, instead of every stream of the entity in the tenant; an empty `ids` list returns no rows and leaving `ids` out keeps the old behaviour. A personal field whose subject key was erased comes back as `PII_ERASED_SENTINEL`, as in `list` and `detail`, so an as-of read can tell an erased value from content. Code that read `kumiko_events` for a set of rows and folded them by hand can call `listAsOf` with `ids` instead.
-->
