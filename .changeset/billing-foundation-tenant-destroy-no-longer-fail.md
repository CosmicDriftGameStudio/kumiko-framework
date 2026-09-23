---
"@cosmicdrift/kumiko-bundled-features": patch
---

Tenant destroy no longer fails on subscription and payment rows

The subscription and payment tenant-destroy hooks passed the tenant-scoped TenantDb they receive into raw DbRunner helpers, so the app-data stage failed and the tenant ended in destroyFailed. They now use ctx.db methods and declare an escapeHatch for the compliance-profile lookup and the event-stream archive.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Tenant destroy no longer fails on subscription and payment rows
-->
