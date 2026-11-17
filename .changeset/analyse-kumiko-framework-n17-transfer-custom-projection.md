---
"@cosmicdrift/kumiko-framework": minor
---

Boot refuses an `r.projection` fed by a `transferable` entity that writes into a table other than the entity's own.

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot rule transfer/custom-projection
detail: tenant-handover moves the entity table rows, the event streams and the search documents of a transferable entity. A separate projection table fed by its events is not moved, so its rows would stay in the source tenant. The new boot rule `transfer/custom-projection` rejects such a projection by name. Projections on the entity's own table and multi-stream projections are not affected.
migration: Move the projected columns into the entity, or drop `transferable` from the source entity.
-->
