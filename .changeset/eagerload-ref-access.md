---
"@cosmicdrift/kumiko-framework": patch
---

`_refs` only carry what the caller may read on the referenced entity

Eagerload used to resolve every referenced row of the tenant, so a reference field pointing at a team- or row-scoped entity leaked rows the caller could not read themselves. It now applies the target entity's `access.read` (row/team scope), its parentRef gate and its field-level read access, still with one batched lookup per reference field. A reference the caller may not read is omitted exactly like a missing one (no existence oracle); the renderer falls back to the UUID. The handler-level `access` of the target's detail handler is not evaluated, the declarative `access.read` of the target entity is authoritative (same model as reference search and sort).

`enrichWithReferences` and `enrichRowWithReferences` take a required fifth argument `viewer: { user, parentVisibility }`. The old strip of PII/encrypted fields on ownership-scoped targets is gone: readable rows are decrypted, unreadable rows are not returned at all.

<!-- kumiko-changes
feature: framework
type: fix
title: _refs respect access.read, the parentRef gate and field-level read of the referenced entity; unreadable refs are omitted and the renderer falls back to the UUID
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: enrichWithReferences and enrichRowWithReferences require a viewer { user, parentVisibility }
migration: Custom handlers pass `{ user: query.user, parentVisibility: { entities: ctx.registry.getAllEntities() } }` as the fifth argument. No direct callers are known in the workspace apps. Apps can now point reference fields at team- or row-scoped entities (for example solon unitId/propertyId).
-->
