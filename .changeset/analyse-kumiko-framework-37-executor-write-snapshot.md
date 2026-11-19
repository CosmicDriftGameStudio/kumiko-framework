---
"@cosmicdrift/kumiko-framework": patch
---

Executor update and delete read the row, the stream version and the archive flag in one statement, so a write can no longer append on a stale snapshot.

<!-- kumiko-changes
feature: framework
type: fix
title: Update and delete check the version they actually loaded
detail: `update` and `delete` used to load the row, check the archive flag and read the stream version in separate statements, the version only after preSave and the guards. A writer committing in between let an update with `skipOptimisticLock` append on an outdated row and `previous` snapshot. The executor now reads row, `MAX(version)` and the archive flag in one statement and appends with exactly that version, so a concurrent commit ends in `version_conflict`. Callers with `skipOptimisticLock` (cascades, config writes) now see that conflict under real concurrency instead of silently overwriting. `expect` preconditions compare against the same row.
-->
