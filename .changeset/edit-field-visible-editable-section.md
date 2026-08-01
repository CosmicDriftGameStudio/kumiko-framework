---
"@cosmicdrift/kumiko-renderer": patch
---

`hasEditableSection` now also respects field-level `visible`, so a visible section whose only editable field is hidden by a field-level `FieldCondition` no longer shows a Save button over zero visible editable fields.
