---
"@cosmicdrift/kumiko-framework": minor
---

Boot refuses a multi-stream projection with a table that applies events of a `transferable` entity.

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot rule transfer/multi-stream-projection
detail: tenant-handover moves a transferable entity's table rows and streams, and r.projection side tables are already refused at boot, but a multi-stream projection with its own table kept the rows it folded from such an entity in the source tenant. Boot now refuses that shape, as it does for r.projection.
migration: Move the projected columns into the entity, drop the projection's table so it only runs side effects, or drop transferable from the source entity.
affects: all
-->
