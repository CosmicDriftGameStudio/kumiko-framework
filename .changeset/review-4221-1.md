---
"@cosmicdrift/kumiko-bundled-features": patch
---

Resumed workflow steps get the registered tenant db instead of a flat copy.

<!-- kumiko-changes
feature: workflow-runner
type: fix
title: Resumed steps receive a registered TenantDb
detail: The resume-run handler handed steps a spread copy of the tenant db. Framework helpers that look a TenantDb up by identity (executors, runInOwnTransaction) rejected that copy with "TenantDb not built by createTenantDb". The steps now get the same db with outsideTransaction dropped in place.
-->
