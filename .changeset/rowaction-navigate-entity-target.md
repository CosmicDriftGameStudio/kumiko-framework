---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

`RowActionNavigate` (rowActions on entityList/projectionList, and header actions on projectionDetail) can now target an entity instead of a screen id: set `entity: "<entityName>"` instead of `screen`. The boot validator resolves it against the screen that declares `detailFor: "<entityName>"` (in any feature), the same way hand-written `nav.navigate({ entity, id })` calls already resolve via `resolveTarget`. `screen` and `entity` are mutually exclusive; `projectionList`/`projectionDetail` entity-targets require an explicit `entityId` field name since those rows have no guaranteed `id` field.
