---
"@cosmicdrift/kumiko-bundled-features": minor
---

tags: add a `rename-tag` write-handler so tag catalogs are editable.

`tags:write:rename-tag` takes `{ id, version, name }` and renames a tag in the
tenant's catalog. It is optimistic-locked (the client sends the `version` it
read, mirroring `tenant:update`) and merges shallowly, so `color` is preserved.
Stale version → `version_conflict` (409); cross-tenant → `not_found` (404).
Exposed as `TagsHandlers.renameTag` + `renameTagPayloadSchema`. Delete-tag stays
deferred.
