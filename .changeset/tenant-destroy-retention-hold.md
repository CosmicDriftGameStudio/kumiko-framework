---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Tenant destruction no longer deletes rows that retention holds with blockDelete, including the files they point at, until their retention period has passed.

<!-- kumiko-changes
feature: framework
type: improvement
title: heldFileRefIds on TenantDataHookCtx
detail: TenantDataHookCtx has an optional heldFileRefIds set with the fileRef ids that rows held by retention still point at. Hooks that delete files must skip them. TenantDataExtensionHooks has an optional phase ("app-data" by default, or "tenant-row") that runs a hook right before the tenant row is tombstoned, after the hold check. Existing hooks keep compiling and keep their behavior.
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: improvement
title: Tenants with blockDelete rows park in destroyHeld
detail: When a destroying tenant owns rows of an entity with strategy blockDelete (entity default, preset, profile or per-tenant override), the destruction pauses before the tenant row in the new tenant status destroyHeld instead of deleting those rows. The sweep ignores destroyHeld tenants and hasTenantDestructionWork does not count them. The daily data-retention cleanup hard-deletes the held rows once their keepFor has passed, including their files, and then moves the tenant back to destroying in the same run. Code that switches exhaustively over the tenant status must handle destroyHeld; it is a transient state between destroying and destroyed and never the final one. The tenant's compliance profile and retention overrides are erased in the tenant-row phase through EXT_TENANT_DATA hooks, so they survive while the tenant is held.
-->

<!-- kumiko-changes
feature: data-retention
type: fix
title: Anonymize no longer emits one event per run for encrypted fields
detail: The retention cleanup compared the encrypted ciphertext with the anonymized value and treated every row with encrypted fields as still needing anonymization, so each run appended another anonymize event. The check now looks at the decrypted value, so already anonymized rows are left alone.
-->

<!-- kumiko-changes
feature: files-tenant-data
type: improvement
title: Tenant destruction keeps files of held rows
detail: The fileRef destroy hook skips the fileRefs listed in heldFileRefIds, and the files prefix sweep keeps their bytes. Without a configured file provider, the retention cleanup still removes the held fileRef rows after keepFor and logs that no bytes could be deleted, so the tenant does not stay in destroyHeld forever.
-->
