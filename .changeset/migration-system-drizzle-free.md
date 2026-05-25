---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

migrations: drizzle-free boot-gate + repair the `kumiko schema` CLI.

Phase 1 of the migration-system consolidation (docs/plans/migration-system-consolidation.md):

- new `assertKumikoSchemaCurrent` / `detectKumikoDrift` boot-gate validates
  `_kumiko_migrations` (applied + checksum) + `kumiko/migrations/.snapshot.json`
  (tables exist), instead of the drizzle journal. `runProdApp` now uses it;
  `options.migrations.dir` default is `./kumiko/migrations`.
- export the migrate-runner / migrate-generator API from `@cosmicdrift/kumiko-framework/db`
  (`runMigrationsFromDir`, `loadMigrationsFromDir`, `fetchAppliedMigrations`,
  `generateMigration`, `loadSnapshotJson`, …) — the `kumiko schema` CLI imported
  these from the barrel where they were never exported (the command was broken).
- `kumiko schema status` no longer imports `drizzle-orm`; new `kumiko schema baseline`
  marks checked-in migrations as applied without running their SQL (DB-adoption /
  legacy cutover).

The legacy drizzle gate (`schema-drift.ts`, `kumiko migrate`) is untouched here and
removed in Phase 3.
