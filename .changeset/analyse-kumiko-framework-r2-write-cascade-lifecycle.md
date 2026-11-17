---
"@cosmicdrift/kumiko-framework": minor
---

onDelete cascades now run inside the delete lifecycle, recursively and with the children's entity hooks.

<!-- kumiko-changes
feature: relations
type: breaking
title: onDelete cascades run automatically in the delete lifecycle
detail: Every delete now applies the onDelete strategy of the entity's hasMany and manyToMany relations, after the entity's own preDelete hooks. Cascaded children run their entity preDelete hooks, their postDelete hooks (inTransaction and afterCommit) and recurse into grandchildren. DeleteContext.cascadedFrom names the parent. createCascadeDeleteHook, SystemHookNames and SystemHookPriorities are removed.
migration: Remove createCascadeDeleteHook from systemHooks or lifecycleSystemHooks wiring. Relations that declared onDelete without wiring the hook now cascade or restrict for real; check those declarations. Hand-written cascades in delete handlers can move to onDelete plus entity preDelete hooks.
-->
