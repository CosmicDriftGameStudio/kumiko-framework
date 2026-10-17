---
"@cosmicdrift/kumiko-bundled-features": patch
---

copy-locale uploads the copied template files before the transaction

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: copy-locale copies the system default's files in a beforeTransaction phase and can no longer run as a nested write
detail: When a tenant copies a locale from the system default, the image and attachment files are now read and written to the tenant's storage in a beforeTransaction phase. The transaction only creates the fileRef rows, and the uploaded binaries are released when it does not commit. Before, the storage I/O held the database transaction open.
migration: Dispatch copy-locale as a top-level command, or from a perCommand handler via ctx.write. A handler that called it nested moves that call into a client or job, or becomes a perCommand handler.
-->
