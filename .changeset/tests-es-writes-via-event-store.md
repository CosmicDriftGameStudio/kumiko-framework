---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-framework": patch
---

Integration tests change event-sourced rows through the event store or the real commands instead of writing projection tables.

<!-- kumiko-changes
feature: tenant
type: improvement
title: Tests no longer write event-sourced tables directly
detail: Integration tests for users, memberships, tenants and user-data-rights change event-sourced rows through the event store or the real commands and reset them with resetTestTables. seedDestroyingTenant in tenant-lifecycle/testing now writes the status through the event store and throws when the tenant stream does not live on the seed SystemAdmin's tenant. Nothing changes for apps; the packages are only republished.
-->
