---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-dispatcher-live": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

feat(es-ops): Phase 1 — file-based seed-migrations

Neues first-class Operations-Pattern fürs Framework. Liefert `seed-migrations`
als drizzle-migrate-equivalent für Event-Sourcing-Aggregate-Updates die
idempotent-Seeder nicht erfassen können (z.B. „Member hat schon eine
Rolle, aber jetzt soll noch eine dazukommen").

Public-API:
- `runProdApp({ seedsDir })` — Auto-apply pending Migrations beim Boot
- `SeedMigration`-Interface (default-Export einer `seeds/<id>.ts`-File)
- `SeedMigrationContext` mit `systemWriteAs` (ruft existing write-handler
  als System-User) + Read-Helpers (`findUserByEmail`,
  `findMembershipsOfUser`, `findTenants`)
- CLI: `bunx kumiko ops seed:new|status|apply`
- Tracking-Table `kumiko_es_operations` mit `operation_type`-Discriminator
  (vorbereitet auf Phase 2+ Operations: projection-rebuild, event-replay,
  stream-migration, ...)
- Env-Flags: `KUMIKO_SKIP_ES_OPS=1` (alle skippen für Recovery),
  `KUMIKO_SKIP_ES_OPS_<ID>=1` (einzelne kaputte skippen)

Garantien: single-run via tracking, atomic via per-migration-Tx,
chronological order via filename-prefix, fail-stop bei Failure (kein
Partial-Apply), ES-konform via Handler-Dispatch.

Sub-path-Export: `@cosmicdrift/kumiko-framework/es-ops`

Plan-Doc: `kumiko-platform/docs/plans/features/es-ops.md`
Recipe: `samples/recipes/seed-migration/`
Driver-Use-Case: publicstatus admin-roles-drift (parallel-Branch
`feat/es-ops-driver-admin-roles`).

Phase 2+ skizziert + offen markiert — Implementation pro Use-Case.
