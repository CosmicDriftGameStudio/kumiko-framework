---
"@cosmicdrift/kumiko-framework": patch
---

Review fixes: tenant reads keep empty and exclusion tenant filters narrow, scoped TenantDbs stay write-denied, reference-data seeding re-creates soft-deleted rows, and version-conflict details report the version actually appended against.

<!-- kumiko-changes
feature: framework
type: fix
title: Empty and exclusion tenant filters no longer widen a read
detail: A where.tenantId of { in: [] } now returns no rows, and { ne } or { notIn } keep excluding the named tenants instead of falling back to the caller's full scope. scopeTenantDbToTenant keeps the write denial of its source TenantDb.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Boot seeding re-creates soft-deleted reference rows
detail: The seed lookup only considers live system-tenant rows, so a soft-deleted reference row is created anew instead of aborting the boot with a not-found error.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Version conflict on update reports the appended-against version
detail: The racing update path now reports expectedVersion as the stream version it appended against, also with skipOptimisticLock or an expect precondition. A failed advisory unlock after a dropped session no longer hides the migration error.
-->
