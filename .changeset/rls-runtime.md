---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Row level security at runtime: connections set the tenant or system scope in every transaction, one rowLevelSecurity value in kumiko.config.ts drives schema tooling and boot, and the test stack and the dev server run with it on.

<!-- kumiko-changes
feature: framework
type: improvement
title: Connections set the row level security scope in every transaction
detail: createDbConnection takes rowLevelSecurity "off" or "on" (default "off", the connection is unchanged). With "on", every statement and transaction sets kumiko.tenant_id and kumiko.scope transaction-locally from the ambient scope. TenantDb sets its tenant, and the system scope for system-mode TenantDbs, global tables and a granted unsafeRaw. Dispatch sets the user's tenant per command, or the system scope for a system-scoped handler. Event store reads and writes use the stream's tenant. Jobs, the event dispatcher, member resolution, migrations, boot seeds, retention, reindex, blind-index cleanup, the PII backfill, projection apply, auth providers and the tenant lifecycle check run in system scope. A statement without a scope sees no tenant rows. The functions that set a scope (runInRowLevelSecurityScope, runInSystemRowLevelSecurityScope, tenantRowLevelSecurityScope, systemScopedRunner) are not part of the public db subpath; framework packages import them from @cosmicdrift/kumiko-framework/internal/row-level-security, which no guard closes to apps yet. App code reaches the system scope through a system-scoped handler, a job or a granted unsafeRaw.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: One rowLevelSecurity value in kumiko.config.ts for schema tooling and runners
detail: AppConfig.rowLevelSecurity ("off" by default) is exported by the managed kumiko/schema.ts as ROW_LEVEL_SECURITY. kumiko-schema generate and validate render and check the policies from it, and apply opens its connection in that mode; the CLI has no flag of its own. The API, worker and all-in-one entrypoints take the same option and refuse a context whose connection runs in another mode. unsafePushTables with "on" reads the catalog first and runs no lock and no DDL for a table that already has ENABLE, FORCE and both kumiko policies.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Projection rebuilds run in system scope under row level security
detail: The rebuild transaction no longer turns row_security off, so a rebuild works as a NOSUPERUSER NOBYPASSRLS table owner under FORCE. Before the first guard read it locks the live table in SHARE UPDATE EXCLUSIVE mode, which blocks policy DDL and a second rebuild of the same table, and reads the catalog. When row level security is enabled, kumiko_tenant_isolation must exist as a PERMISSIVE policy for ALL commands and PUBLIC and no RESTRICTIVE policy may exist; otherwise the rebuild fails with the table and its policies and leaves the live table untouched. Other permissive policies carry over to the swapped-in table. Multi-stream rebuilds follow the same rule.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runProdApp checks the row level security state at boot
detail: RunProdAppOptions.rowLevelSecurity ("off" by default) sets the mode of every connection; the scaffolded server entry passes appConfig.rowLevelSecurity. With "on", boot fails when the database role has SUPERUSER or BYPASSRLS, because Postgres then skips every policy, and when a table with tenant_id lacks ENABLE, FORCE or one of the two kumiko policies; the message lists the tables. With "off", boot fails while any table still has row level security enabled and points to the DISABLE migration that kumiko-schema generate writes.
-->

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: User data export and forget cleanup run in system scope
detail: runUserExport and runForgetCleanup walk every tenant of a user, so they enter the system scope themselves instead of depending on the caller's scope. A direct call outside a job no longer exports or erases nothing under row level security "on".
-->

<!-- kumiko-changes
feature: testing
type: breaking
title: The test stack runs with row level security on as role kumiko_app
detail: setupTestStack creates the role kumiko_app (LOGIN NOSUPERUSER NOBYPASSRLS, password taken from TEST_DATABASE_URL) once, makes it owner of the test database and opens every pool as that role with rowLevelSecurity "on"; template databases are built the same way. stack.db runs in system scope and sees every tenant's rows as before. The new stack.unscopedDb is the enforced pool the services use, on which a statement without a scope sees no tenant rows. rowLevelSecurity: "off" in the stack options restores the superuser stack without policies. createTestDb takes applicationRole: true for the same setup.
migration: App code that reads or writes tenant tables through a raw connection outside a request, a job or a TenantDb now sees no rows in integration tests. Test code that calls such a path directly runs it inside runInSystemRowLevelSecurityScope or runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantId), ...) from @cosmicdrift/kumiko-testing/helpers. Production code works through a TenantDb for the tenant, a job, a system-scoped handler or a granted unsafeRaw. Tests that need superuser rights on stack.db, such as CREATE EXTENSION, CREATE ROLE or event triggers, open their own connection from TEST_DATABASE_URL or use createTestDb(). Manual migration, there is no codemod.
-->

<!-- kumiko-changes
feature: dev-server
type: breaking
title: The dev server runs with row level security on
detail: runDevApp and createKumikoServer default to rowLevelSecurity "on" and run the dev stack as kumiko_app. On boot against a persistent dev database, the stack creates the role and transfers ownership of the database and of the public schema's tables, views and sequences to kumiko_app. The database user in DATABASE_URL needs the right to create roles, which the superuser of a local Postgres has. Code that reads tenant tables through a raw connection without a scope sees no rows in development; the boot does not detect this. runSchemaApply takes rowLevelSecurity, and the managed kumiko/schema.ts exports ROW_LEVEL_SECURITY from appConfig; the managed file updates on the next sync.
migration: Pass rowLevelSecurity: "off" to runDevApp while fixing code paths without tenant context; the dev database keeps kumiko_app as owner. A server entry written by an older scaffold passes appConfig.rowLevelSecurity to runProdApp by hand once the app turns row level security on. Manual migration, there is no codemod.
-->
