---
"@cosmicdrift/kumiko-bundled-features": patch
---

Account forget-cleanup removes userOwned files uploaded by someone else

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Account forget-cleanup removes userOwned files uploaded by someone else
detail: runForgetCleanup now purges the bytes, derivatives and file_refs rows behind every file field whose subject is the deleted user, not only files the user uploaded; a failing byte delete keeps the user in DeletionRequested so the next run retries.
-->
