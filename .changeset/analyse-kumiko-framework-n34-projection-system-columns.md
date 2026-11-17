---
"@cosmicdrift/kumiko-framework": patch
---

`setFields` stamps `modifiedAt` and `modifiedById` from the event, and `projectionInsertColumns` and `projectionUpdateColumns` give hand-written projection applies the system columns.

<!-- kumiko-changes
feature: projections
type: improvement
title: Projection system columns come from the event
detail: A projection apply that writes an entity-shaped table had to fill tenantId, insertedAt, insertedById, modifiedAt and modifiedById by hand, and a missing insertedAt fell back to the SQL default now(), so a rebuild wrote other timestamps than the live run. `projectionInsertColumns(table, event)` returns tenantId, insertedAt and insertedById, and `projectionUpdateColumns(table, event)` returns modifiedAt and modifiedById, each from the event and only for columns the table declares. `setFields` now stamps the update columns itself, and values passed to it win. The row version stays with the framework.
-->
