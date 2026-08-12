---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`ImageFieldDef` accepts `capture?: "environment" | "user"`, forwarded to the file input's `capture` attribute so a phone opens the camera instead of the file picker. Omitted by default, so existing image fields are unchanged.

Not added to `ImagesFieldDef`: multi-image fields still have no widget (they render an "unsupported" banner), and a flag no renderer reads is the dead-flag state `thumbnails` was just removed for.
