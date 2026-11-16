---
"@cosmicdrift/kumiko-framework": patch
---

Rebuilding an entity table now replays every `r.projection` registered on that same table, and rebuilding such a projection by name rebuilds the whole entity table instead of replacing it.

<!-- kumiko-changes
feature: projections
type: fix
title: Entity rebuild replays r.projection on the entity's own table
detail: An `r.projection` whose `table` is an `r.entity` table ran live but was skipped by `rebuildProjection`, so a rebuild reset its columns (for example a closed flag set by `setFields`). The registry now merges those applies into the entity's implicit projection: lifecycle and repeated keys run in registration order, keys already covered by `r.extendEntityProjection` keep the extension's apply. `rebuildProjection` on the explicit projection's name now rebuilds the owning entity projection; before, it replaced the entity table with rows from the projection's events only.
-->
