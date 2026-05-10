---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix `db.execute is not a function` crash in `createTierEngineFeature`'s
auto-default-tier postSave-hook when called via the dispatcher path
(`tenant:write:create`). The hook used `ctx.db as DbConnection` — a
type-lie. AppContext.db in the inTransaction-phase is a TenantDb, which
exposes select/insert/update/delete but not execute(). The event-store-
append (event-store.ts:102) calls `db.execute(sql\`SELECT pg_notify(...)\`)`,
which crashed at runtime.

Fix: typeguard via `if (!("raw" in ctx.db)) return` then use `ctx.db.raw
as DbConnection` (pattern matched signup-confirm.write.ts:107).

Plus: regression integration-test in `tier-engine/__tests__/auto-default-
tier.integration.ts` covering the dispatcher path (sysadmin →
tenant:write:create → tier_assignments-row + idempotency on tenant-update).

**Known production gap (separate from this fix):** Self-Signup goes through
`provisionSignupAccount → seedTenant` (event-store-direct), which bypasses
the dispatcher → postSave-hooks never fire in production self-signup. This
fix makes the dispatcher path coherent. Real-signup auto-default needs
follow-up work (either seedTenant fires hooks or signup-confirm calls
explicit seed-helpers).
