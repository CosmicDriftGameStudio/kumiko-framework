---
"@cosmicdrift/kumiko-framework": patch
---

`insertProjectedEntityRow` and `patchProjectedEntityRow` accept `null` for an optional field, so a projection can clear an optional money or located timestamp field in the same patch. A `null` located timestamp now clears its `Utc` and `Tz` columns; before, the combined key was left in the row and the helper rejected it as an unknown column.
