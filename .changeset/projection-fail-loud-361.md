---
"@cosmicdrift/kumiko-framework": minor
---

feat(migrations): fail-loud for managed projection tables emptied without a resolvable rebuild (#361)

`runPendingRebuilds` accepts an optional `thisRunTables` (the tables freshly
queued by `queueRebuildsFromMarkers` in this apply run). Rebuild markers only
ever list managed projection tables, so a table emptied **this run** that no
registered projection resolves means the owning feature is missing from the
composition — its projection is now silently empty. Such tables are reported
in a new `unresolvedManaged` field on `PendingRebuildRun` and logged at error
level, instead of being silently drained.

Non-fatal by design: the queue still drains (no sticky-stuck re-apply), and
pre-existing pending tables (not in `thisRunTables` — indistinguishable from
legacy unmanaged markers or composition drift) stay in the benign `unmapped`
set, so upgrades with old markers don't break. Without `thisRunTables` the
behavior is unchanged (every unmapped table → `unmapped`). Follow-up to #356.
