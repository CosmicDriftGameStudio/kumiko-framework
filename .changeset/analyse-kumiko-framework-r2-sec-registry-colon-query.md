---
"@cosmicdrift/kumiko-framework": minor
---

Query handlers with a colon in their name that map to no entity must declare resultEntity or unfilteredResult in features with read-restricted fields.

<!-- kumiko-changes
feature: framework
type: breaking
title: Unmapped colon queries need resultEntity
detail: The boot check that query handlers of a feature with read-restricted or writeOnly fields name their resultEntity skipped every handler with a colon in its name. It now skips only handlers mapped to an entity. A query like "report:overview" with no "report" entity fails the boot until it sets resultEntity or unfilteredResult.
migration: Add resultEntity (the entity whose rows the query returns) or unfilteredResult: { reason } to the reported handler, or rename it to an entity:verb that exists.
affects: queryHandler, resultEntity, unfilteredResult
-->
