---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

fix(tenant): updateMemberRoles erlaubt "system"-Rolle (symmetrisch zu create)

Drift innerhalb des tenant-Features: `tenant:write:create` akzeptierte
`["system", "SystemAdmin"]`, `tenant:write:update-member-roles` aber
nur `["SystemAdmin"]`. Konsequenz: ops-tooling und seed-migrations
(`createSystemUser` mit `roles: ["system"]`) konnten den Handler nicht
aufrufen — `access_denied`.

Live entdeckt beim ersten Driver-Sample der es-ops Phase 1: publicstatus
seed `2026-05-20-fix-admin-roles.ts` rief `update-member-roles` via
`systemWriteAs` → access_denied → Pod CrashLoopBackOff.

Plus access-rule-Pinning-Test in `tenant.integration.ts`-scenario-7.
