---
"@cosmicdrift/kumiko-framework": minor
---

Entity graph traversal helpers for cross-tenant ownership changes

physicalColumnName is now exported from @cosmicdrift/kumiko-framework/db (was framework-internal). storageKeyStemPrefix (files/file-handle.ts) gives the prefix that covers a stored file's key plus every derive()d variant. StorageProviderHookCtx (EXT_STORAGE_PROVIDER destroy hooks) gains db: DbRunner — the tenant-destroy stage runner already carried it for this hook family unconditionally, this only widens the declared type to match. TenantDataHookCtx (EXT_TENANT_DATA destroy hooks) gains fileProviderResolver and log, threaded through from the same stage runner. Built for the tenant-handover bundled feature (kumiko-framework#3035); no behavior change for existing hook implementations that don't read the new fields.

<!-- kumiko-changes
feature: framework
type: improvement
title: Entity graph traversal helpers for cross-tenant ownership changes
-->
