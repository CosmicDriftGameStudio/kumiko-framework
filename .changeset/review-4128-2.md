---
"@cosmicdrift/kumiko-framework": patch
---

SQL derived list values (count, first) over another entity are only released to roles that have a query handler of that entity, no longer to roles that merely hold a handler naming it in `liveEntities`.

<!-- kumiko-changes
feature: framework
type: fix
title: derived values no longer follow liveEntities mentions
detail: `derivedSql.canReadEntity` used `collectEntityReadAccess`, which also counts handlers that list an entity in `liveEntities`. Such a handler returns signals, not rows, so a role holding only that handler could read counts and first values over the entity. The check now uses the new `collectEntityQueryAccess`, which only counts query handlers whose own entity is the one asked about; live signals keep `collectEntityReadAccess`.
-->
