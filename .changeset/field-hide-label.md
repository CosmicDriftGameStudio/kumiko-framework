---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix #1870: `FieldProps` and all `*Field` widgets (`SelectField`, `TextField`, `DateField`,
`BooleanField`, `TextareaField`, `RangeField`, `FileField`, `NumberField`) gain a `hideLabel`
prop that visually collapses the label to `sr-only` while keeping it associated via `htmlFor`.
For table/grid columns where the header already carries the label.
