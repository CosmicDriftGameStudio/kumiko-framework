---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer": patch
---

`multiline: { rows: N }` on a `text`/`longText` field now visibly changes the textarea height. The row count reached the rendered `<textarea rows>` attribute all along, but the vendored shadcn Textarea carries `field-sizing: content`, which derives the box height from the content and makes the attribute inert — a declared `rows: 16` still rendered a ~3-line field. The default textarea primitive now also derives an inline `min-height` from `rows`, so the field starts at the declared number of lines and keeps growing with its content. Textareas without an explicit `rows` are unchanged (`min-h-16` as before).
