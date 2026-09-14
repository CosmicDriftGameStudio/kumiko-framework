---
"@cosmicdrift/kumiko-framework": patch
---

Fix: field `unit` and entity `defaultCurrency` were dropped from the client schema. `buildAppSchema` now forwards a number field's `unit` (static string or `{ field }`) and the entity's `defaultCurrency`, so the edit-form unit suffix renders and money fields use the declared currency instead of always falling back to "EUR". The same projection gap is closed for other properties the edit view-model reads: text `format` (password masking), timestamp `locatedBy` (wall-clock input), file/image `accept`/`maxSize`/`variants`, and decimal `scale` (incl. embedded sub-fields).
