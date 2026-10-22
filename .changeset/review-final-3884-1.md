---
"@cosmicdrift/kumiko-framework": patch
---

Live signals no longer name row ids to roles that only read some rows. When an entity's own `access.read` is an ownership map (for example `Driver: from("user:id", "assigneeId")`), a connection whose roles do not include an `"all"` rule gets the entity signal without `id` and `version`, like a row-filtered query result.

<!-- kumiko-changes
feature: framework
type: fix
title: live signals hide row ids from row-filtered roles
detail: createSseRoute takes an optional entityRowReadMaps option, built from entity access.read by the server routes. A signed-in connection receives id and version only if the entity has no read ownership map or one of its roles is mapped to all; otherwise the signal carries just the entity and event type so the client refetches.
-->
