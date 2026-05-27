---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Server build: bundle all server entries in a single `Bun.build` with code splitting so the framework is emitted once as a shared chunk instead of inlined per entry. `dist-server/` shrinks ~66% (publicstatus ~41 MB → ~14 MB), boot/migrate stay separate entries, no deploy change. Drops the dead drizzle `migration-hooks.js` + `drizzle.config.ts` bundling and the `drizzle-kit`/`drizzle-orm` runtime externals — the migrate path uses `runMigrationsFromDir`.

Schema migrations: `kumiko schema generate` now writes a `NNNN_<name>.rebuild.json` marker next to each migration listing the changed/new tables, so the apply step can rebuild the affected projections. New helpers `writeRebuildMarker` / `readRebuildMarker` / `rebuildTablesFromDiff` are exported from the `db` entrypoint.
