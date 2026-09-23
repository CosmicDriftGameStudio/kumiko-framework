---
"@cosmicdrift/kumiko-bundled-features": patch
---

Tenant destroy no longer fails on billing and inbound-mail rows

The billing-foundation (subscription, payment) and inbound-mail-foundation (mail-account, inbound-message, mail-thread) tenant-destroy hooks passed the tenant-scoped TenantDb they receive into raw DbRunner helpers, so the app-data stage failed and the tenant ended in destroyFailed. They now use ctx.db methods and declare an escapeHatch for the event-stream archive and compliance-profile lookup.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Tenant destroy no longer fails on billing and inbound-mail rows
-->
