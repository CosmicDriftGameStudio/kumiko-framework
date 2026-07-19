---
"@cosmicdrift/kumiko-framework": minor
---

Rename `r.rawTable()` to `r.storeTable()` and reject `read_` as a table-name prefix
at registration (#1220). `read_` is reserved for `r.entity()`/`r.projection()`
(managed, event-sourced, rebuildable) — `r.storeTable()` is the unmanaged
direct-write escape hatch, and a `read_`-prefixed name on it was misleading. Types
follow the same rename: `RawTableOptions`/`RawTableEntry`/`RawTableDef` →
`StoreTableOptions`/`StoreTableEntry`/`StoreTableDef`, `getAllRawTables()` →
`getAllStoreTables()`. Unprefixed names (e.g. `in_app_messages`) stay legal — the
guard bans `read_`, it doesn't mandate a `store_` prefix.

Bundled features rename their `read_`-prefixed direct-write tables to a `store_`
prefix: `mail_sync_cursors`, `mail_seen_messages`, `delivery_attempts`,
`job_run_logs`, `user_sessions`, `api_tokens`, `global_feature_state`. Kumiko has
no `ALTER TABLE RENAME` migration path (table identity is name-keyed), so
consumers regenerating migrations against this version will see a destructive
drop+create pair for these 7 tables instead of a rename — plan a maintenance
window if they carry data you need (sessions/API-tokens will force re-auth,
mail-sync-cursors will force a full resync).
