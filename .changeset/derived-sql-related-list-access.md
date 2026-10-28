---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

Derived fields can be computed in SQL and sorted, relatedList tabs follow query access and can count from their own query.

<!-- kumiko-changes
feature: framework
type: improvement
title: SQL derived fields, query-gated relatedList tabs, count badge
detail: A derived field with `sql` (coalesce over fields, or a related-table count, countDistinct or first with optional label and conditions incl. activeOn/today/now) is computed inside the list SELECT and may set `sortable: true`, also as entityList defaultSort; JS `derive` fields stay display-only and read the SQL values. Related rows and measured fields respect the viewer's read access, a gated value is NULL. GET /api/schema removes relatedList sections (tabs, entityEdit sections, expandableRow) whose query the caller's roles cannot run, and metrics linking to a removed tab lose their navigate. `count: true` on a relatedList tab shows the tab badge from the section's own query total. A metric only becomes clickable when its entityId target resolves, and groupBy labels now also resolve for entities with a backingTable. `valueType: "money"` is allowed for a SQL derived `related` + `first` on a money field: amount and currency are read together and the row carries the stored money shape (no key when unset), sorting is by minor units. Ownership where-rules of a label target or related table are qualified with the subquery's own alias (a label of a row the viewer cannot read no longer leaks when the target is the outer entity), the related entity and label target must also be readable through a query handler of the viewer's roles, backingTable entities are read from their real table, an entity may derive from itself, and a sortable related derived field needs an index on the join column.
-->
