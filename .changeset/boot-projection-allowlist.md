---
"@cosmicdrift/kumiko-framework": patch
---

`validateBoot` now calls `validateProjectionAllowlist`. Violations that passed silently before fail at boot: `unsafeProjectionUpsert`/`unsafeProjectionDelete` without `r.requires.projection`, on aggregate tables, tier-2 steps without `r.requires.step`, pipeline closures that read the payload while the step list is built, and two features registering the same aggregate table. Aggregate tables are matched by their physical table name, so an entity without an explicit `table` is protected as well.

<!-- kumiko-changes
feature: framework
type: fix
title: Boot enforces the projection allowlist
detail: The projection allowlist validator existed but was never called from validateBoot. It now runs as the last cross-feature check. It also keys aggregate tables by the physical table name (entity.table or the derived read_* name) instead of the entity name, so unsafeProjection steps on the table of an entity without an explicit table, and duplicate tables between a derived and an explicit name, are detected.
migration: Apps with such violations fail at boot. Add the missing r.requires.projection or r.requires.step declaration, or use r.step.aggregate.* for aggregate tables.
-->
