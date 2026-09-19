---
"@cosmicdrift/kumiko-framework": minor
---

The tenant-teardown 410 gate is derived from the mounted tenantLifecycleStatus provider (fw#2881).

buildServer now resolves the EXT_TENANT_LIFECYCLE_STATUS extension point itself, so every server with tenant-lifecycle mounted rejects requests against a tenant in teardown with 410 tenant_unavailable — prod, dev and test stacks can no longer drift because one entrypoint forgot the wiring. An explicit auth.resolveTenantLifecycleStatus still takes precedence and stays the escape hatch. A mounted provider without context.db is a boot error instead of a silently skipped gate.

<!-- kumiko-changes
feature: framework
type: improvement
title: The tenant-teardown 410 gate is derived from the mounted tenantLifecycleStatus provider (fw#2881).
-->
