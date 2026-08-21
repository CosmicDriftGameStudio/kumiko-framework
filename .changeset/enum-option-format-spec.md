---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`FieldFormatRegistry` gains an `enumOption` format key (`{ format: "enumOption", keyPrefix: "..." }`) that resolves an enum value to its translated label through the standard option-key convention (`<feature>:entity:<entity>:field:<field>:option:<value>`), client-side.

`applyFormatSpec` takes an optional `translate` parameter; `FieldRendererOutput` (`projectionDetail` fields) and `DataTableCell` (`entityList`/`projectionList`/`relatedList` columns) now pass `useTranslation()` through. An untranslated key falls back to the raw enum value, mirroring `buildOptionLabels`'s convention for `entityList` select columns.

This closes the last gap that forced server-side enum translation via hand-rolled locale dictionaries (fw#2315, solon#203): a query handler no longer needs to know the request's locale to make an enum value readable.
