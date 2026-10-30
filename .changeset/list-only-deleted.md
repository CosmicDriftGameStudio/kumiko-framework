---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-feature-ast": patch
---

Entity list queries take `onlyDeleted: true` and return just the soft-deleted rows, the list a trash screen needs next to `<entity>:restore`.

<!-- kumiko-changes
feature: framework
type: feature
title: List payload flag onlyDeleted for trash lists
detail: The entity list query accepts onlyDeleted: true and returns only is_deleted rows. Tenant, ownership and read scopes, filter, search, totalCount and aggregate apply unchanged, with the same access rule as includeDeleted. onlyDeleted together with includeDeleted is a validation error, as is onlyDeleted on an entity without softDelete. Custom query handlers read it as ctx.onlyDeleted; export payloads drop it like includeDeleted.
-->
