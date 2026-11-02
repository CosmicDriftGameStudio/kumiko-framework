---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Boot now rejects hand-written `<entity>:update`, `:delete` and `:restore` write handlers on an entity with `parentRef`, because they bypass the parent visibility gate. Register them via `defineEntityWriteHandler` or pass `parentVisibility: parentVisibilityFor(ctx, event.user)`.

<!-- kumiko-changes
feature: parent-ref
type: fix
title: boot guard covers update, delete and restore handlers of parentRef entities
detail: The `parentRefHandWrittenQuery` guard only checked list and detail, so a hand-written write handler on a join-row entity could change rows whose host the caller cannot see. `defineEntityWriteHandler` now sets `ENTITY_CONVENTION_WRITE_BRAND` (kept through `r.writeHandler`), and the new rule `parent-ref/hand-written-write-handler` fails boot for an unbranded `update`, `delete` or `restore` handler on such an entity.
-->
