---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Poison-event quarantine for projection rebuilds (#760).

- A single historical event whose apply handler throws no longer has to permanently block a rebuild. Opt-in quarantine mode confines each apply to a driver-native savepoint: the poison event is rolled back, recorded into the new `kumiko_rebuild_dead_letters` table, and the replay completes. `RebuildResult.eventsSkipped` reports the count.
- Single-stream: `RebuildDeps.errorPolicy.skipApplyErrors` (per run). Default stays strict — first throwing apply aborts the rebuild.
- MSP: `MspErrorMode.rebuild.skipApplyErrors` (falling back to `continuous`) is now honored by `rebuildMultiStreamProjection` — the option was declared but previously never implemented for rebuilds.
- New ops surface: `listRebuildDeadLetters(db, { projectionName })`, `runInSavepoint(tx, fn)` (bun-db).
- The `jobs:job:projection-rebuild` payload accepts `skipApplyErrors: true` for operator-triggered quarantine runs.
