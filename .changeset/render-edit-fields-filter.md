---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-headless": minor
---

Fix #1895: `RenderEdit` gains an optional `fields?: readonly string[]` prop to
render only a subset of the layout's fields. Section order, title, and
visibility still come from the layout — the caller only supplies a field-name
list, not a duplicated layout shape. A section whose filtered field list ends
up empty is dropped entirely rather than rendered empty.

Submit validation is scoped to the same set: `SubmitConfig.validateScope` (new
optional field on `@cosmicdrift/kumiko-headless`) restricts `submit()`'s
internal `validate()` call to the given field names, so a schema-required
field outside the `fields` filter can no longer block a submit the user has
no way to fix.

Both are additive and optional — without `fields`, existing `RenderEdit`
behavior is unchanged.
