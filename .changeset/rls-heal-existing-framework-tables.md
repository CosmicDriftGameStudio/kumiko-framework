---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-guards": patch
---

`kumiko schema apply` now adds the missing row-level security (ENABLE/FORCE and policies) to existing framework tables with a tenant column (`kumiko_events`, `kumiko_archived_streams`, `kumiko_snapshots`, the dead-letter tables) when `ROW_LEVEL_SECURITY` is `"on"`. Databases created before row-level security was switched on no longer abort the boot with "tenant tables lack row-level security". `kumiko schema validate` runs the boot's row-level security check against the live database when `DATABASE_URL` is set, and the boot error names `kumiko schema apply` for framework tables. The error-reasons guard no longer reports `grants: { unsafeRaw: { reason } }` and the other escape-hatch grants.

<!-- kumiko-changes
feature: framework
type: fix
title: schema apply heals row-level security on existing framework tables
detail: Existing databases got no policies on kumiko_events, kumiko_archived_streams and kumiko_snapshots, so boot failed while schema validate stayed green.
-->
