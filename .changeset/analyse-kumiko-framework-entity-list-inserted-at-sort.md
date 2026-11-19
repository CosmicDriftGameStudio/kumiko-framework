---
"@cosmicdrift/kumiko-framework": patch
---

An entityList can sort by default on the base columns `insertedAt` and `modifiedAt`.

<!-- kumiko-changes
feature: framework
type: improvement
title: entityList defaultSort on insertedAt and modifiedAt
detail: Boot accepted `insertedAt` and `modifiedAt` as list columns but rejected them as `defaultSort`, `sortOptions` or named-filter `sort` field (`entity-list/default-sort-unknown-field`, `entity-list/default-sort-not-sortable`), although every entity table has both columns and the list handler already sorts on them with a keyset cursor. Both are now accepted, so `defaultSort: { field: "insertedAt", dir: "desc" }` lists newest first without a derived field. Other names that are neither an entity field nor one of these base columns are still rejected.
affects: validateBoot
-->
