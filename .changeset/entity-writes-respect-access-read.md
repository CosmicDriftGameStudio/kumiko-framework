---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Entity update, delete, restore and forget now answer not_found for a row the caller cannot read, including a join row whose parentRef host the caller cannot read.

<!-- kumiko-changes
feature: entity-access
type: breaking
title: Entity writes on a row the caller cannot read fail with not_found
detail: update, delete, restore and forget only checked access.write, so on an entity with an owner access.read rule and no access.write any tenant member with handler access could change or delete another member's row, and delete returned the decrypted row. They now apply the same access.read rule and parentRef host-visibility gate as detail and answer not_found, so the row's existence stays hidden. Framework system writes are exempt. A write the caller could not read but that failed the write rule before now reports not_found instead of ownership_denied.
migration: Writes on rows the caller cannot read now fail with not_found; give such writers read access or run them as system. Custom handlers that call the executor directly get the parentRef gate by passing parentVisibility: { entities: ctx.registry.getAllEntities() }, as the generated handlers do.
-->
