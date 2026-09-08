---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

`projectionDetail` screens can now declare a `writeForm` section: a `kind: "writeForm"` layout section with its own `fieldDefs`/`fields` and a `handler` write-handler QN, rendered as an editable form that submits through the ambient dispatcher and reloads the screen (record + any relatedList sections) on success. Unlike every other `projectionDetail` section, its fields are never forced `readOnly:true` — a `writeForm` field's own `readOnly`/`required` wins.

`relatedList` sections gain `rowActions`, the same `RowAction` shape (`navigate` / `writeHandler`, with a declarative `payload` extractor) already used by `entityList`/`projectionList` row actions, dispatched through the identical execution path — no second row-action mechanism. The boot-validator rejects `writeForm` on `entityEdit`/`configEdit`/`actionForm` (mirroring the existing `relatedList` restriction), an unregistered `writeForm`/`rowAction` handler, a `writeForm`/`relatedList` section in a wizard layout, a `writeForm` field missing from its own `fieldDefs`, and more than one row-click source on a `relatedList` section.
