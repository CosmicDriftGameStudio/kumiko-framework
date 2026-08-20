---
"@cosmicdrift/kumiko-bundled-features": patch
---

The audit log table rendered full 36-character UUIDs in its aggregate and actor columns. They carry no meaning for a reader and pushed the table far past the viewport on anything narrower than a desktop screen, cutting off the columns to their right. Both now show an 8-character short id (`folder-assignment / 4fd943be`); the aggregate type is unchanged, and the detail screen still shows both ids in full.
