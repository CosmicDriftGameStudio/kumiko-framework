---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

relatedList columns can be formatted like entityList columns

A relatedList section (projectionDetail tab or entityList `expandableRow`) takes an optional `entity`: an entity name or `feature:entity`. Columns that name a field of that entity render through the same cell formatter as an entityList column. A select shows as a status badge with its translated option label, dates are locale-formatted, and the header defaults to the field's label key. A column's own `sortable` still controls the header sort. The boot validator rejects an `entity` that does not resolve. Without `entity`, columns render as before.

<!-- kumiko-changes
feature: renderer
type: improvement
title: relatedList columns format select, date and other field types like entityList columns (entity)
-->
