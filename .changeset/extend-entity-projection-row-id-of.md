---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

`r.extendEntityProjection` accepts `rowIdOf`, the row id the extension's applies write for events on its `sources` when that id is not the aggregate id (for example a tenant-salted `uuidv5(tenantId|aggregateId)` over workflow events). The ghost-row guard of the projection rebuild now counts a live row as backed when its id is `rowIdOf` of a source event, so such projections can be rebuilt instead of aborting. The guard stays strict: a row keyed by the raw aggregate id of a derived source still aborts the rebuild.

`rowIdOf` requires `sources`, must not name the entity's own stream, and must return a uuid; a source shared by several extensions needs the same `rowIdOf` in all of them. Violations fail at boot. `ProjectionDefinition` carries the result as `extraSourceRowIds`, and `assertNoUnreachableLiveRows` takes it as an optional fifth parameter. New type `ProjectionRowIdOf`.

<!-- kumiko-changes
feature: framework
type: improvement
title: rowIdOf on extendEntityProjection for derived row ids
-->
