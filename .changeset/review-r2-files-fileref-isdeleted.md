---
"@cosmicdrift/kumiko-framework": patch
---

The exported `FileRef` type no longer carries `isDeleted`. Soft-deleted rows were already filtered out before the guard sees a file, so the field was never reachable. Custom file access guards that read `fileRef.isDeleted` must drop that check.

<!-- kumiko-changes
feature: framework
type: breaking
title: FileRef type drops the unreachable isDeleted field
migration: |
  Remove reads of `fileRef.isDeleted` in custom file access guards; soft-deleted rows never reach the guard.
-->
