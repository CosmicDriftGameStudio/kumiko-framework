---
"@cosmicdrift/kumiko-bundled-features": patch
---

The document-ingest-foundation tenant-destroy hook now uses the tenant-scoped `ctx.db` it receives from the tenant-lifecycle pipeline instead of re-wrapping it in `createTenantDb`. Before, the "app-data" stage failed for every tenant with documentExtract rows and the tenant ended in `destroyFailed`.

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: Tenant destroy no longer fails on documentExtract rows
-->
