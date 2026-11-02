---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Row level security no longer lets a tenant session read system tenant rows of credential, session, secret and PII tables. The system tenant read policy `kumiko_system_tenant_read` is now created only on tables classified with the new `systemRowsReadable` marker.

<!-- kumiko-changes
feature: row-level-security
type: breaking
title: system tenant read policy only on tables marked systemRowsReadable
detail: Since 0.390.0 users, MFA, API tokens, sessions and tenant secrets live on the system tenant, and `kumiko_system_tenant_read` (tenant_id = system tenant) sat on every table with a tenant_id column, so a tenant session could read them past a missing TenantDb filter. The policy is now a positive classification: `systemRowsReadable: true` on an entity (or `defineUnmanagedTable` input) renders it, entities targeted by `r.referenceData` are classified implicitly, and every other table gets only `kumiko_tenant_isolation`. Marked in the bundled features: `read_config_values`, `read_template_resources`, `read_custom_field_definitions`, `read_pages` (app-wide public pages on the system tenant). Paths that read system rows of an unmarked table use a narrow read path instead of the system scope: the new `systemTenantReadDb(db)` (internal/row-level-security) is a read-only TenantDb on the system tenant, so RLS passes exactly its rows and no other tenant's. `secrets:list` with scope system, `readFileRefContent` (system template files) and the SystemAdmin read of system files in the file routes use it; `secrets.get/has` read platform-wide secrets in the system tenant's own scope. `ctx.dispatch.queryAsMember` reads the stored user profile under the system scope, the reference check of eager-loading runs on the referenced table's scope, and the event-store executor runs its raw reads and writes on a `tenancy: "global"` table in the system scope, like the TenantDb's own statements on it. The boot check expects exactly the classified set and reports a system read policy on an unmarked table; `unsafePushTables` and `kumiko-schema apply` drop it from the framework tables (`kumiko_events`, `kumiko_snapshots`, `kumiko_archived_streams`). `KnownTables` has a new required member `readsSystemRows`.
migration: Apps: bump, then run `bun kumiko-schema generate` and commit the new RLS migration; it drops `kumiko_system_tenant_read` on every table without the marker (credential and PII tables included). Set `systemRowsReadable: true` on an own entity only if tenant sessions read its SYSTEM_TENANT_ID rows (shared templates, defaults, catalogs); a table without it returns no system rows to a tenant session. Code that must read system rows of an unmarked table (credentials, PII) wraps its db in `systemTenantReadDb`. Hand-built `KnownTables` objects passed to the boot check need `readsSystemRows`.
-->
