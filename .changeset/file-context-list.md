---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

`ctx.files` (`FileContext`) gains `list(prefix)`, delegating to the already-required `FileStorageProvider.list`. Derived variants (thumbnails, resized images, …) live under deterministic, hashed storage keys that are never written back onto the originating `FileRef` row, so the only way to find them is a prefix listing — previously only the GDPR hook's `buildStorageProvider` could do that. Ordinary handlers deleting a file through `ctx.files` had no way to discover and delete its variants, leaving them as orphaned bytes.
