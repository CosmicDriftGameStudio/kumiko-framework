---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A soft-deleted row keeps holding its file: sharing checks count it, a rebind may target it, and the soft-delete cleanup removes bytes and fileRef together with the last holder. Subject erasure purges a file shared by several records of the same subject (live or soft-deleted).

<!-- kumiko-changes
feature: files
type: fix
title: Soft-deleted rows keep holding their files until they are forgotten for good
detail: A soft-delete keeps the bytes so a restore finds the file (see DELETE /files/:id). The shared-file check of retention hardDelete and subject erasure used to ignore soft-deleted holders and deleted the bytes under them; it now counts them, preferring a live holder for the rebind. `rebindFileRef` accepts a soft-deleted target in the system user's tenant. The per-tenant soft-delete cleanup now purges the bytes, derivatives and fileRef of an expired row before forgetting it, and keeps the row when that fails. `purgeRowFileRefs` and its helpers moved from bundled-features to the framework `files` entry; bundled-features/shared re-exports them.
affects: files, soft-delete, retention, forget-subject, rebindFileRef
-->
