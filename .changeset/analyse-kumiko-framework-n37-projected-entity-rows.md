---
"@cosmicdrift/kumiko-framework": patch
---

Projections write rows of an entity table through typed helpers that fill the row metadata from the event.

<!-- kumiko-changes
feature: framework
type: improvement
title: insertProjectedEntityRow and patchProjectedEntityRow for entity rows written by domain events
detail: `insertProjectedEntityRow(tx, { entityName, entity, table }, event, rowId, values)` inserts a row with `tenantId`, `insertedAt` and `insertedById` taken from the event, and `version` from the event on the row's own stream, else 1. `patchProjectedEntityRow` sets the given fields plus `modifiedAt`/`modifiedById` from the event and leaves `version` to the stream. Values are typed by the entity's fields; a key that is no field column, or a row-metadata key, throws instead of being dropped or failing in SQL. Every value comes from the event, so a rebuild reproduces the row; a row written from another stream needs an id derived from that event's tenantId and aggregateId, declared as `rowIdOf` through `r.extendEntityProjection` with the same applies.
-->
