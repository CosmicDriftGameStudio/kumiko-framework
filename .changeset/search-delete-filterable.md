---
"@cosmicdrift/kumiko-framework": patch
---

Meilisearch indexes always get the attributes that removing an entity's documents filters on.

<!-- kumiko-changes
feature: search
type: fix
title: Meilisearch keeps _entityId and _chunk filterable on every index
detail: The Meilisearch adapter merges _entityId and _chunk into the stored filterableAttributes of an index it keeps (also one configured with its own searchable attributes), instead of adding them only when it applies its default configuration. Before, removing an entity from such an index failed because the delete filter used attributes that were not filterable.
-->
