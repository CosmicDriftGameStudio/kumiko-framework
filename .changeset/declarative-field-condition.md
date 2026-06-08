---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

feat(screen-types): declarative FieldCondition and RowFieldExtractor replace function props

`FieldCondition` is now a JSON-safe union (`boolean | { field, eq } | { field, ne }`) instead of `(data, ctx) => boolean`. `visible`, `readOnly`, and `required` on `EditFieldSpec` and row-action props use the new declarative form. `RowFieldExtractor` props (`entityId`, `params`, `payload`) are also declarative (`"fieldName"` / `{ pick }` / `{ map }`). All function-form props are removed — they were silently dropped by `JSON.stringify` in schema-injection.
