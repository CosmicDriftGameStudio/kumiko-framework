---
"@cosmicdrift/kumiko-framework": patch
---

File upload: projections run, failed uploads leave no row or blob, system files stay private

<!-- kumiko-changes
feature: framework
type: fix
title: Upload route creates the fileRef row in its own transaction, cleans up bytes on failure and excludes system files from unclaimedUploadReaders
detail: The file routes and the API server use createProjectingTenantDb so projections on fileRef.created run. When the row insert or a projection throws, the upload route rolls the row back, deletes the stored bytes and answers 500. Files uploaded by the system user are no longer readable through unclaimedUploadReaders.
-->
