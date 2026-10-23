---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-cli": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-guards": minor
---

Postgres row level security is on by default, system scopes carry a mandatory reason, and the event write path keeps the caller's tenant scope.

<!-- kumiko-changes
feature: framework
type: breaking
title: rowLevelSecurity defaults to "on"
migration: |
  In the app repo, once with the bump: run `kumiko sync-managed --write` (the managed kumiko/schema.ts now reads `export const ROW_LEVEL_SECURITY = appConfig.rowLevelSecurity;`), then `kumiko schema generate` and commit the migration. It contains ENABLE and FORCE ROW LEVEL SECURITY plus the policies `kumiko_tenant_isolation` and `kumiko_system_tenant_read` for every tenant table. The schema apply (the migrate init container in production) creates them; there is no manual database step. Without the migration, boot at "on" refuses to start and names the unprotected tables.
  The app's database role must not skip policies; boot refuses it otherwise. Check it as that role with `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user` (both must be false). Callers of createDbConnection without a mode now get "on"; tools that touch no tenant rows (schema baseline/status, the KMS key store) pass "off" explicitly, and the operator commands backfill-pii, waitlist-migrate, project and consumer run on an enforcing connection in system scope, so they work against both modes.
  Way back: set `rowLevelSecurity: "off"` in kumiko.config.ts and run `kumiko schema generate`; the generated migration contains DISABLE ROW LEVEL SECURITY and drops the policies. At "off" runProdApp and runWorkerApp log a boot warning.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: runInSystemRowLevelSecurityScope and systemScopedRunner take a reason
migration: |
  Call runInSystemRowLevelSecurityScope("<why this access spans tenants>", fn) and systemScopedRunner(runner, "<reason>"). An empty or whitespace reason throws InternalError; the scope leak assertion names the reason.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: A projection write under a tenant scope can no longer land in another tenant
migration: |
  A command that writes an entity row for another tenant through ctx.db now fails with SQLSTATE 42501; move that write to ctx.systemDb.acknowledgeCrossTenant in an r.systemScope() feature.
detail: applyEntityEvent keeps an ambient tenant scope instead of wrapping every write in a system scope. Writes for other tenants go through ctx.systemDb.acknowledgeCrossTenant in an r.systemScope() feature. Replays, rebuilds and global entities still write system scoped.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: New guard internal-subpath-imports
detail: Flags kumiko-framework/internal/* imports outside the framework repo, row level security scope helpers from kumiko-testing/helpers in non-test code, and system scope calls without a literal reason.
-->

<!-- kumiko-changes
feature: jobs
type: fix
title: Tenant job run rows are written in the tenant's scope
detail: With row level security on, the queued, started and finished rows of tenant-visible job runs were rejected by Postgres when the job was dispatched outside a request scope, and the logger only logged the error. The logger now scopes its tenant writes, and a row-level-security violation is rethrown instead of swallowed.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: composeFeatures no longer warns about its own bundled copies
detail: Composing the output of a first composeFeatures pass again drops the earlier bundled instances silently; only copies the app supplied itself still warn.
-->
