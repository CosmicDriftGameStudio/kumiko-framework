---
"@cosmicdrift/kumiko-framework": minor
---

Add `r.searchPayloadExtension(entity, fn)` API. Contributor functions add flat fields to an entity's search-index document during `buildSearchDocument` indexing.

Use-cases:
- `custom-fields-bundle` (upcoming): merge customFields-jsonb-keys flat into search-doc so tenant-defined fields are searchable
- Tags-bundle: project tags-array into searchable form
- Computed-fields: denormalize related-counts (e.g., `messageCount` on conversation)

Contributor receives `{entityName, entityId, state}`, returns extras to merge. Async-allowed but discouraged (indexing-path hot loop).

Boot-validation: typo'd entity-names fail-fast at registry-build (sibling to entity-hooks boot-validation).

Part of custom-fields-bundle Sprint Phase F3.
