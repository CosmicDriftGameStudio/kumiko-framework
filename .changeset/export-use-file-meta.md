---
"@cosmicdrift/kumiko-renderer": patch
---

`useFileMeta`, the `FileMeta` type and `FileViewAction` are exported from `@cosmicdrift/kumiko-renderer/web`.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useFileMeta is public
detail: `useFileMeta(fileId)` returns the file name and MIME type of a file. Lookups of all cells in one render are batched into one `GET /api/files/meta` request and cached for the session, so apps can decide per row (for example "is PDF") without their own per-row request. New exports: `useFileMeta`, type `FileMeta`, and `FileViewAction` (a "view" button that opens a PDF in a drawer).
-->
