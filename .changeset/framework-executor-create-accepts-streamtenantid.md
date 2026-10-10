---
"@cosmicdrift/kumiko-framework": minor
---

Executor create accepts streamTenantId; ctx.forTenant(tenantId) for gated cross-tenant writes

createEventStoreExecutor().create takes { streamTenantId } (stream, event tenant, row tenant, PII key and cache invalidation follow it, the acting user stays the operator). The override is accepted on a system-mode db and also on a tenant-mode db bound to exactly that stream tenant. New handler-context method ctx.forTenant(tenantId) returns { db, streamTenantId }: a tenant-mode db bound to the target tenant plus the stream override to pass to the executor, so a handler needs no unsafeRaw escape hatch for cross-tenant writes. A foreign tenant is gated to SystemAdmin and system identities (AccessDeniedError with reason tenant_override_requires_system_admin otherwise); the caller's own tenant returns streamTenantId undefined. It is not offered to r.systemScope() handlers. The bundled cross-tenant handlers (tenant removeMember/updateMemberRoles, tier setTenantTier, custom-fields system fields, template-resolver upserts/set, managed-pages set, compliance-profiles setProfile) no longer rewrite event.user.tenantId; the event actor is the operator. tenant cancelPendingInvitation takes an optional streamTenantId.

<!-- kumiko-changes
feature: framework
type: improvement
title: Executor create accepts streamTenantId; ctx.forTenant(tenantId) for gated cross-tenant writes
-->
