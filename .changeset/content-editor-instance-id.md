---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

**Breaking:** `ContentEditorProps` gains a required `id: string` — every registered content editor (`TextareaContentEditor`, `PlainContentEditor`, `RichContentEditor`/`TiptapEditor`) now renders it onto its own focusable root element instead of the fallback textarea's fixed `CONTENT_EDITOR_ELEMENT_ID`. A custom-registered content editor component now needs to accept and use this `id` prop; consumers that don't touch the DOM id directly are unaffected. Previously, a `Field` wrapping a registered "rich"/"plain" editor pointed its `htmlFor` at that fixed id, which only the never-mounted textarea fallback actually used — the label was disconnected from the real input as soon as a collection declared `contentFormat: "rich"` or `"plain"`.

`template-resolver`'s `TextBlockEditor` now generates a per-instance id via `useId()` and passes it to both the `Field` and the `ContentEditor`, so the label stays correctly associated and two editors mounted on the same page no longer collide on a shared DOM id. `CONTENT_EDITOR_ELEMENT_ID` stays exported as a default value for callers that don't need their own generated id.
