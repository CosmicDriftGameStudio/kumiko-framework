---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`ImageFieldDef` gets an optional `capture?: "environment" | "user"`, threaded through to the native `<input type="file">` on the image widget. On a phone, this opens the camera directly instead of a generic file picker. Unset keeps today's behavior unchanged.

`ImagesFieldDef` also gets the type field for forward-compatibility, but it isn't wired to a renderer yet — the plural `images` field type has no upload widget of its own (deferred to #1925), so `capture` there is inert until that widget exists.
