---
"@cosmicdrift/kumiko-bundled-features": patch
---

`writeDocumentExtractForLiveFileRef` now returns `{ kind: "skipped", reason: "already_extracted" }` when the fileRef already has a documentExtract, so a redelivered `documentIngest.requested` or a delete-restore race no longer creates a second extract. Providers need no existence check of their own; code that switches exhaustively on `reason` must handle the new value.

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: Writing a document extract is idempotent per fileRef
-->
