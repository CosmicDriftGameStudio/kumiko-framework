---
"@cosmicdrift/kumiko-bundled-features": patch
---

The GDPR forget run now deletes the user's export ZIPs from storage and ends their open export jobs instead of leaving them until the download TTL runs out.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Forget run deletes the user's export ZIPs and ends open exports
detail: run-forget-cleanup never touched read_export_jobs, so a finished export bundle (profile, email, name, files) stayed downloadable through its magic link until expiresAt and stayed in storage until expiresAt plus the cleanup grace, about eight days after the user was marked Deleted. The run now deletes every done or failed export bundle of the user through the same per-tenant storage provider it uses for file binaries and clears downloadStorageKey through the event-store executor in the user's sub-transaction, before the subject key erase and the status flip. A failed storage delete rolls the user back to DeletionRequested and reports an error with entityName "export-job", like a failed file-binary delete; the next run retries. Without a resolvable storage provider the bundle is skipped with a warning and its key kept, so the export storage-cleanup pass still removes it later. Both the run-forget-cleanup handler and the maintenance job are covered. Pending and running export jobs of the user are failed in the same step with errorMessage "cancelled: user erased"; a running job keeps its downloadStorageKey for the storage-cleanup pass. The export worker builds no ZIP for a user marked Deleted, skips a job whose erased check or claim fails with an unexpected error (only the job id is logged) and goes on with the next one, checks again after writing and deletes a ZIP it finishes after the forget run without issuing a token or flipping the job to done. If the forget run lands between the check after writing and the done flip, the job ends failed with the same message, no failure mail is sent and the token is expired. The storage-cleanup pass removes the bundle of a Deleted user at once, even for done jobs before expiresAt. download-by-token answers a Deleted user's link, expired or not, like an unknown token and writes no audit row for it. Restricted and DeletionRequested users keep their export (Art. 15 and 20).
-->
