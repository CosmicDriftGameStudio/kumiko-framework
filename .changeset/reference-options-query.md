---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

Reference fields can source their picker from a query handler

`labelField` names one column of the referenced entity, so an entity whose identity is composed from joined rows — a lease identified by its tenant and unit, not by any column on the lease row — has no right answer, only a least-wrong one, and its picker lists raw dates or UUIDs. `ReferenceFieldDef.optionsQuery` (also on a reference sub-field of an embedded field) names a query handler that returns `{ rows: { id, label }[] }` and receives `{ limit, search? }` like the default list handler, so the app composes the label itself. The picker, the read-only display of a reference value and an embedded-list reference cell all read it; the QN is pinned at boot against the registered handlers, the same treatment `DashboardFilterDefinition.optionsQuery` gets.

It is additive, not a replacement: `labelField` keeps serving the paths a query handler cannot back, since list cells, `searchable` and `sortable` all resolve to an SQL column on the referenced table. A field without `optionsQuery` behaves exactly as before.

<!-- kumiko-changes
feature: framework
type: feature
title: Reference fields can source their picker from a query handler
-->
