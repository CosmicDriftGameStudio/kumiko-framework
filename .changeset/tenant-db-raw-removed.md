---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`TenantDb.raw` is removed — the only DbRunner escape hatches off `ctx.db` are now `ctx.db.unsafeRaw(reason)` (gated by `escapeHatch: { reason }`) and `db.global(table)` writes. Framework infrastructure (the event-store executor, engine steps, entity-convention `crossTenant` handlers, `UncheckedSystemDb.unsafeRaw`) resolves its connection through a framework-private `tenant-db-runner.ts` binding instead, which feature code cannot import. `asRawClient` and the raw-SQL helpers built on it (`countWhere`, `transaction`, `runInSavepoint`/`runInSavepointIfSupported`, `executeRawQuery`/`executeRawQueryRead`, `upsertOnConflict`, `incrementCounter`, `insertMany`, `deleteManyBatched`) now throw when handed a tenant-scoped `TenantDb` instead of silently unwrapping it. `fireEntityPostSave`'s optional 4th argument changed from a bare `tenantId` to `{ tenantId, db }` — a caller re-scoping the hook context now hands in its own already-declared `DbRunner`. The boot validator now also rejects a `tenancy: "global"` entity whose owning feature does not declare `r.systemScope()`.

New codemod `scripts/codemod/migrate-db-raw.ts` rewrites `ctx.db.raw` to `ctx.db.global(table)` (for `tenancy: "global"` tables) or `ctx.db.unsafeRaw(reason)` in test files and reports every non-test site for a manual reason.
