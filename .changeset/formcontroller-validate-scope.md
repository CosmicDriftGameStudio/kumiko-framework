---
"@cosmicdrift/kumiko-headless": minor
---

`FormController.validate()` accepts an optional `scope` field-name list. Scoped calls report only issues for fields in `scope`; root-level `.refine()` issues (path `(root)`) are always excluded from scoped runs and only surface on an unscoped `validate()`. Hidden-field filtering stays active in both modes.
