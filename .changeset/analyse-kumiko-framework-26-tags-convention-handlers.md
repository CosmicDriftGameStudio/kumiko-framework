---
"@cosmicdrift/kumiko-bundled-features": minor
---

tags writes its catalog only through `tag:create`, `tag:update` and `tag:delete`; the duplicate `create-tag`, `update-tag` and `delete-tag` handlers are gone.

<!-- kumiko-changes
feature: tags
type: breaking
title: Legacy tag catalog handlers removed
detail: tags registered every catalog write twice, once for TagManager and once for the catalog screens. Only `tags:write:tag:create` (flat `{ name, color?, scope? }`), `tags:write:tag:update` (`{ id, version, changes }`) and `tags:write:tag:delete` (cascades over the assignments) remain, and `TagsHandlers.createTag`, `updateTag` and `deleteTag` point to them. `tag:update` rejects a colour that is not a hex code with `invalid_color`. The exports `createUpdateTagHandler`, `updateTagHandler`, `updateTagPayloadSchema` and `UpdateTagPayload` are removed; `createCreateTagHandler` and `createDeleteTagHandler` now default to the names `tag:create` and `tag:delete`.
migration: Dispatch `TagsHandlers.createTag`, `updateTag` and `deleteTag` instead of the strings `tags:write:create-tag`, `tags:write:update-tag` and `tags:write:delete-tag`, and send `tag:update` the envelope `{ id, version, changes: { name?, color?, scope? } }` instead of the flat payload.
affects: tags:write:create-tag, tags:write:update-tag, tags:write:delete-tag, TagsHandlers, tag:update, createUpdateTagHandler, updateTagHandler, updateTagPayloadSchema, UpdateTagPayload, createCreateTagHandler, createDeleteTagHandler
-->
