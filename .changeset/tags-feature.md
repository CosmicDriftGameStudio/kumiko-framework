---
"@cosmicdrift/kumiko-bundled-features": minor
---

Neues bundled-feature `tags`: generisches, host-agnostisches Tagging für **jede**
Entity — ohne Spalte am Host, ohne Migration, ohne relationalen Pivot/JOIN.

Das Feature besitzt zwei event-sourced Entities: den per-Tenant Tag-Katalog
(`read_tags`) und `tag-assignment`-Join-Rows, gekeyt auf `(entityType, entityId)`
(`read_tag_assignments`). Beide Tabellen projiziert das Framework aus ihren
eigenen CRUD-Events — kein handgeschriebener MSP. Eine deterministische
aggregate-id pro `(tenant, tag, entity)` macht `assign-tag`/`remove-tag`
idempotent.

Handler: `tags:write:create-tag`, `tags:write:assign-tag`, `tags:write:remove-tag`
sowie List-Queries für Katalog und Assignments. Cross-Entity-Sichten („Tags einer
Entity" / „Entities mit einem Tag") entstehen durch Komposition im Read-Layer —
`tag-assignment:list` gefiltert auf `entityId` bzw. `tagId`. Default-Rollen via
`createTagsFeature({ roles })` überschreibbar.

Siehe `samples/recipes/tags-basic/`.
