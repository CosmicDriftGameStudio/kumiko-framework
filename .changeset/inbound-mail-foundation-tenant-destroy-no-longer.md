---
"@cosmicdrift/kumiko-bundled-features": patch
---

Tenant destroy no longer fails on mail-account, inbound-message and mail-thread rows

The inbound-mail tenant-destroy hooks passed the tenant-scoped TenantDb they receive into raw DbRunner helpers, so the app-data stage failed and the tenant ended in destroyFailed. They now use ctx.db methods and declare an escapeHatch for the event-stream archive.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Tenant destroy no longer fails on mail-account, inbound-message and mail-thread rows
-->
