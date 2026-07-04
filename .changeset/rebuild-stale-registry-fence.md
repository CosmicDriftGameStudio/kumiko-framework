---
"@cosmicdrift/kumiko-framework": patch
---

fix(rebuild): fence projection rebuilds against a stale registry (#835)

`rebuildProjection` and the MSP rebuild now abort — inside the rebuild tx,
before building the shadow — when the live table's column names do not match
this process's `EntityTableMeta` (`assertLiveColumnsMatchMeta`). Previously a
pod still running the previous build (rolling deploy) could pick up an async
rebuild job and swap in a shadow built from stale meta, silently dropping a
freshly-migrated column (#494 recurrence class). The rebuild now fails loud
with the differing columns in the error; retrying from a pod whose code
matches the migrated schema succeeds.
