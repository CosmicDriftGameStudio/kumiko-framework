---
"@cosmicdrift/kumiko-bundled-features": patch
---

`tenant:write:update`'s manual cross-tenant self-check (`event.payload.id !== event.user.tenantId`) is now `ctx.systemDb.assertTenantMatch(...)`, the fw#2067 fail-closed primitive. Same predicate (bound to `event.user.tenantId` at dispatch), same externally observable behavior — a cross-tenant `Admin` write still gets `tenant_not_found`, `SystemAdmin` still updates any tenant. Pattern reference for the remaining `#2056` migration sub-issues.
