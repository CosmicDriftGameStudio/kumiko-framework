---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-guards": minor
---

extraContext factories get the raw db in the test stack and dev, createTenantDb in system mode takes a reason, and a new guard rejects session-level row level security settings.

<!-- kumiko-changes
feature: testing
type: breaking
title: extraContext factories get the raw db in the test stack and dev
migration: |
  Services built in extraContext that read across tenants at request time, or that a test calls directly, must scope themselves: createTenantDb({ db, tenantId, mode: "system", reason: "<why>" }). Test code reads through stack.db.
detail: The test stack and dev now pass the enforcing pool to extraContext factories, as runProdApp does, so request-time services keep the ambient request scope and a tenant leak shows up in tests instead of only in production.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: createTenantDb mode system requires a reason
migration: |
  Add `reason: "<why this access spans tenants>"` to every createTenantDb({ mode: "system" }) call. The reason must be a non-empty string literal: an empty reason throws InternalError at construction, and the internal-subpath-imports guard rejects a missing, empty or non-literal reason.
detail: The system scope a TenantDb opens for its statements now carries that reason, so a scope leak assertion names the call site. Tenant mode takes no reason.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: New guard rls-session-settings
detail: Flags SET and SET SESSION on kumiko.* settings and set_config with is_local false in any source or test string, kumiko.* writes outside rls-scope.ts in non-test code, and a set_config in rls-scope.ts without literal true. A session-level setting survives on a pooled connection and leaks one request's scope into the next.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: Export applicationRoleUrlOf from kumiko-testing/stack
detail: Use it to boot runProdApp in tests against the app role. It returns the URL of a database as the non-bypass application role with the password of TEST_DATABASE_URL; pair it with createTestDb({ applicationRole: true }).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Signature routes read and write secrets in a system scope
detail: With row level security on, verify() and the handler of a signature route (subscription webhooks, mail connect callbacks) read the secrets of a tenant named by the signed request before any tenant scope exists, and failed. deps.secrets now opens the system scope for each secret access only, so plugin code that parses the unauthenticated body stays unscoped.
-->
<!-- kumiko-changes
feature: testing
type: improvement
title: The test application role is realigned to the configured password
detail: createApplicationRole used to return early when the role existed, so a kumiko_app role with another password made every integration test fail with 28P01. It now runs ALTER ROLE with the configured password and the NOSUPERUSER NOBYPASSRLS attributes.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: RLS boot check tells known tables from orphaned ones
migration: |
  assertRowLevelSecurityBootState takes the known tables as a required third argument: pass knownTablesOf(features), both exported from the db subpath.
detail: With rowLevelSecurity on, the boot check lists tenant tables without row-level security in two groups. Tables the app schema knows point to kumiko schema generate. Tables no feature declares anymore, including retired framework tables, are named as orphaned and point to dropping them by migration. The check itself stays strict.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: rls-session-settings also scans .sql files
detail: Consumer migrations are checked statement by statement for session-level SET kumiko.*, set_config with is_local false and any kumiko.* write.
-->
