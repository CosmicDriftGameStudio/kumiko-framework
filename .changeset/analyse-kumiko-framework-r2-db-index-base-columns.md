---
"@cosmicdrift/kumiko-framework": patch
---

`entity.indexes` accepts every row-meta base column, such as `insertedAt` and `modifiedAt`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Entity indexes on base time columns
detail: Boot validation accepted only `tenantId`, `id` and `version` as non-field index columns, so an index like `["tenantId", "insertedAt"]` for newest-first lists failed with entity-index/unknown-column. Every row-meta column buildEntityTable creates is now allowed (`insertedAt`, `modifiedAt`, `insertedById`, `modifiedById`, and `isDeleted`, `deletedAt`, `deletedById` on softDelete entities). Table builder and migration generator map them to their snake_case columns.
-->
