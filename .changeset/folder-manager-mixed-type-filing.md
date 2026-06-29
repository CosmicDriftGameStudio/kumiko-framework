---
"@cosmicdrift/kumiko-bundled-features": minor
---

FolderManager: per-leaf `entityType` override so a single filing tree can hold leaves of mixed entity types (e.g. credits + Bausparverträge), each filed/cleared under its own type. `FolderLeaf.entityType` is optional and defaults to `filing.entityType`, so existing single-type callers are unaffected.
