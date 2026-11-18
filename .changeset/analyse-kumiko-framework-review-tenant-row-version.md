---
"@cosmicdrift/kumiko-bundled-features": patch
---

Tenant destroy stage events now run the tenant projection, so the tenant row version follows its stream.

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: Tenant row version follows the destruction stage events
detail: The destruction pipeline appended its stage events to the tenant stream without running the projections, so read_tenants.version stayed behind the stream. A SystemAdmin update of a destroying tenant failed with version_conflict and a projection rebuild produced a different row than the live path. Every stage event now runs the projections after the append. The test helper seedDestroyingTenant from tenant-lifecycle/testing now takes the test stack (db and registry) instead of the db, so its started event projects as well.
migration: Replace seedDestroyingTenant(stack.db, tenantId) with seedDestroyingTenant(stack, tenantId).
-->
