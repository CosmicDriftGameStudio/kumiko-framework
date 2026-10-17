---
"@cosmicdrift/kumiko-framework": patch
---

TenantDb reads honour where.tenantId given as { in } or { eq }

<!-- kumiko-changes
feature: framework
type: fix
title: A where.tenantId of { in: [...] } or { eq } narrows TenantDb reads instead of being ignored
detail: TenantDb.readWhere only understood a plain id or an array. An operator form fell back to the full read scope (own tenant plus reference rows), so { in: [ownTenant] } still returned SYSTEM reference rows. It now unwraps { in } and { eq } with the same helper the read steps use for their narrowing warning. Ids outside the caller's scope are still dropped and never widen the read.
-->
