---
"@cosmicdrift/kumiko-framework": patch
---

Fix `setupTestStack` (ephemeral Playwright/e2e test DBs) never creating `r.unmanagedTable` tables — only `collectTableMetas` (used by `kumiko schema generate`) accounted for them, so any app mounting a feature with an unmanaged table (e.g. the bundled `sessions` feature's `read_user_sessions`) got a hard 500 on every write against that table in an ephemeral test stack, even though the real migration history was correct. `enumerateFeatureTableSources` — the single source both consumers share — now includes `unmanagedTables`.
