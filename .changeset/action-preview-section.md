---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

Adds a new `actionPreview` `EditLayout` section kind for `projectionDetail` screens: a declarative "test run" primitive with input fields (`fieldDefs`/`fields`), a query- or write-handler QN dispatched with those values, and a `resultFields` field-type map that renders the return value read-only through the same field-rendering machinery as any other field. Nothing is persisted and no refetch follows a run — this fills the gap where the existing row-action dispatch discards a handler's return value.
