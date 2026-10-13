---
"@cosmicdrift/kumiko-framework": minor
---

The per-tenant soft-delete cleanup now removes the stored bytes of expired soft-deleted fileRefs, derivatives included, before it removes their rows. Before, the rows were deleted and the binaries stayed in storage. A row whose bytes could not be deleted, or that is processed without a file provider, stays and is retried by the next run.

<!-- kumiko-changes
feature: framework
type: fix
title: Soft-delete cleanup removes the bytes of expired fileRefs
detail: softDeleteCleanupJob handles the fileRef entity through purgeExpiredFileRefsWithBytes, which deletes the original and its derivatives via the file provider and then only the rows whose bytes are gone. Failures are logged and retried on the next run.
-->
