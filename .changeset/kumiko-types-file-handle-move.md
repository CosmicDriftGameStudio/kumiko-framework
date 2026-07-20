---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`FileContext`/`FileHandle` move from `packages/framework/src/files/file-handle.ts` to `@cosmicdrift/kumiko-types/file-handle-types`. The old path stays a re-export, so no internal import site changes. `FileStorageProvider` (from `files/types.ts`) is unrelated to these two types and stays put.
