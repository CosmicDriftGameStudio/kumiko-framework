---
"@cosmicdrift/kumiko-framework": patch
---

`seedReferenceData` now adopts reference-data rows that were seeded before the event-store executor existed. Such rows have no events, so changing a value after the upgrade failed the boot with a stream-version conflict and a projection rebuild dropped the rows. The seeder now deletes the eventless row and re-creates it under the same id through the executor.

<!-- kumiko-changes
feature: framework
type: fix
title: reference-data seed adopts rows that have no event stream
detail: Rows from installs that seeded reference data by direct insert are re-created under the same id through the executor on the next boot, so updates apply and the rows survive a rebuild. No action is needed; the row id is unchanged, only its version restarts at 1.
-->
