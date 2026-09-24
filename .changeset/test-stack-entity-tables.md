---
"@cosmicdrift/kumiko-framework": patch
---

setupTestStack creates r.entity() tables — same table list as kumiko schema generate (fw#3102)

<!-- kumiko-changes
feature: framework
type: fix
title: setupTestStack creates r.entity() tables — same table list as kumiko schema generate (fw#3102)
detail: |
  Since 0.290.0 (fw#2881), every authenticated request reads `read_tenants` (rejectIfTenantTeardown) as soon as tenant-lifecycle is mounted. Test stacks needed a manually created tenant table for that to work, because setupTestStack pushed projection/multiStreamProjection/storeTable sources but never r.entity() tables. setupTestStack now creates every entity's backing table itself via collectTableMetas, the same table list `kumiko schema generate` uses, so a feature that only declares r.entity() no longer 42P01s on first write in a test stack. App-side wrappers like `unsafeEnsureEntityTable(db, tenantEntity, "tenant")` right after setupTestStack can be removed. Callers that create/migrate entity tables themselves can opt out via `entityTables: false` (used internally by `setupAppTestStack`'s `registryTables: false`), and setupTestStack now drops the ephemeral test DB/Redis if the table DDL fails instead of leaking them.
-->
