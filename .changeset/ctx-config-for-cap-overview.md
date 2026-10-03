---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

Handlers get `ctx.configFor(tenantId)`, a config accessor resolved for another tenant. The cap overview uses it so a cross-tenant limit reads the target tenant's config instead of the caller's.

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.configFor(tenantId) resolves config for another tenant
detail: |
  Query and write handler contexts get `configFor(tenantId)` next to `config`, present when the config feature wired its accessor factory. The accessor runs as the target tenant's system user on a db scoped to that tenant, so the caller's user-scope values never leak into the result. Calls for another tenant throw `AccessDeniedError` unless the caller is the system identity or has the `SystemAdmin` role; the caller's own tenant needs no privilege and returns the same accessor as `ctx.config`.
migration: |
  No code change needed. Handlers that compute values for a tenant other than the caller's (limits, quotas, billing previews) call `ctx.configFor(tenantId)` instead of passing `ctx.config`.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: ctx.configFor on the handler context types
detail: |
  `configFor?: (tenantId: TenantId) => ConfigAccessor` is part of the shared handler context fields, optional like `config`.
migration: |
  No code change needed.
-->

<!-- kumiko-changes
feature: cap-overview
type: fix
title: Cross-tenant cap limits read the target tenant's config
detail: |
  `caps:usage` with a SystemAdmin `tenantId` override and `tenant-caps:list` passed the caller's config accessor to `CapSpec.limit`, so a limit that reads a tenant-scoped config key showed the caller's value for every tenant. Both now resolve one accessor per target tenant through `ctx.configFor`, and `tenant-caps:list` resolves each tenant's limit separately instead of once per tier.
migration: |
  No code change needed.
-->
