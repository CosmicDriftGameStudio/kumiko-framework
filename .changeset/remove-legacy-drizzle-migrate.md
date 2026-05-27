---
"@cosmicdrift/kumiko-framework": minor
---

Remove the legacy drizzle migration system. Dropped: the drizzle-kit `kumiko migrate` command, the drizzle-journal boot gate (`assertSchemaCurrent` / `detectDrift` / `loadJournal` + schema-drift snapshot helpers), the snapshot-diff projection detection (`compareSnapshots` / `detectProjectionsToRebuild` / `latestMigrationTag` / `projectionsFromChanges`), and the legacy `<tag>__rebuild.json` marker helpers — all from `@cosmicdrift/kumiko-framework/migrations`.

Use the drizzle-free `kumiko schema` path: `assertKumikoSchemaCurrent` (boot gate), `runMigrationsFromDir` (apply), and the `db` rebuild markers (`readRebuildMarker` / `writeRebuildMarker` / `rebuildTablesFromDiff`). `buildProjectionTableIndex` is retained (moved to its own module, still exported from `/migrations`).
