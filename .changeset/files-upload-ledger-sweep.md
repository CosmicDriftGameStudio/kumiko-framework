---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Orphaned upload bytes are swept

Bytes written by `POST /files`, `createFileRefFromBytes`, `uploadFileBytesBeforeTransaction` and the seed `createFileRef` are recorded in the new `store_file_upload_ledger` table before they reach storage. The commit that creates the fileRef row removes the ledger row in its own transaction. The new hourly `files:job:sweep-orphaned-uploads` job deletes the bytes (original and derivatives) of uploads still unclaimed after `uploadSweepGraceHours` (default 24, minimum 1; option of `createFilesFeature`). A commit that arrives after its upload was swept fails with `upload expired`. Plain `files.ref(key).write()` stays untracked and is never swept.

`FileContext` gains `writeUploadBytes` and `forgetUploadBytes`, `FileProviderResolver` may carry `uploadLedgerFor`, and `TenantDb.deleteMany` now returns the number of deleted rows. Build a tenant's `FileContext` with `createTenantFileContext(resolver, tenantId)` so it carries the resolver's ledger.

<!-- kumiko-changes
feature: files
type: breaking
title: Orphaned upload bytes are swept through a new upload ledger
detail: The files feature registers the store_file_upload_ledger table and an hourly sweep job. FileContext has the new methods writeUploadBytes and forgetUploadBytes, which the four upload paths use; a custom FileContext or resolver must provide the ledger (withUploadLedger wraps a resolver). TenantDb.deleteMany resolves to the number of deleted rows instead of void. A fileRef commit whose ledger row was already swept throws InternalError "upload expired".
migration: Generate and apply a migration with `kumiko-schema generate` — uploads fail without the new store_file_upload_ledger table
-->
