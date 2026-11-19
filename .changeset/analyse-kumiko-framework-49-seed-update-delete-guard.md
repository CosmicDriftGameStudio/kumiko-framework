---
"@cosmicdrift/kumiko-testing": minor
---

`updateRows` and `deleteRows` throw on an event-sourced entity table unless the test passes `{ projectionOnly: reason }`, like `seedRow` already does.

<!-- kumiko-changes
feature: testing
type: breaking
title: updateRows and deleteRows refuse event-sourced entity tables without a reason
detail: `seedRow` and `seedRows` already refused an `r.entity` table without `{ projectionOnly }`, but `updateRows` and `deleteRows` changed such rows silently, so a test could set up projection state that no event history produces and that a rebuild undoes. Both now take an optional last `options` argument and throw synchronously on an event-sourced entity table unless `options.projectionOnly` names the scenario. The error points to `updateRowViaEventStore` or `deleteRowViaEventStore`. Tables without event sourcing are unaffected.
migration: Calls of `updateRows(db, table, set, where)` or `deleteRows(db, table, where)` on an `r.entity` table switch to `updateRowViaEventStore` / `deleteRowViaEventStore`, or pass `{ projectionOnly: "<scenario>" }` as the last argument when the event-less change is the point of the test.
affects: updateRows, deleteRows
-->
