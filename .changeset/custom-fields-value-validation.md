---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

custom-fields: validate set-custom-field values against the fieldDefinition.

`set-custom-field` now rehydrates the field's `serializedField` into the
framework's `fieldToZod` schema and validates the incoming value (Builder-Reuse
/ Plan-Doc "Stammfeld-Identität"). Type mismatches return 422 and emit no event,
so the jsonb projection stays typed. `fieldToZod` is now exported from
`@cosmicdrift/kumiko-framework/engine`.

Scope: type-validation only — required-on-set, default-application and the
searchable-filter remain out of scope.
