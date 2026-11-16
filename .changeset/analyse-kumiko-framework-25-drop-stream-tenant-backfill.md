---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

API and worker no longer run the one-time stream-tenant backfill on every boot.

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: Boot no longer runs the stream-tenant backfill; search option removed
detail: `runProdApp` and `runWorkerApp` ran `runStreamTenantBackfillOnBoot` on every boot, a one-time migration that moved legacy tenant, membership and user streams onto their target tenant. Every app has run it since well before 0.420, so the step, the module and the `search` boot option, which only that step read, are removed. The `stream-migration` es-operations type stays for existing rows.
migration: Remove `search: "none"` from the `runProdApp` and `runWorkerApp` options if it is set. Before deploying this version, check that `kumiko_es_operations` holds no open `stream-tenant-backfill:*:derived-pending` row; a database that never ran an earlier version has to boot one first.
-->

The tenant feature drops its stream-tenant backfill exports.

<!-- kumiko-changes
feature: tenant
type: breaking
title: backfillTenantStreamTenants removed
detail: The one-time tenant and membership stream backfill is gone together with the boot step that called it. Removed exports: `backfillTenantStreamTenants`, `TenantStreamBackfillDeps`, `TenantStreamBackfillResult`.
migration: No app calls these exports; nothing to change.
-->

The user feature drops its stream-tenant backfill exports.

<!-- kumiko-changes
feature: user
type: breaking
title: backfillUserStreamTenants removed
detail: The one-time user stream backfill is gone together with the boot step that called it. Removed exports: `backfillUserStreamTenants`, `backfillUserStreamTenantsWithDerivedState`, `UserStreamBackfillResult`, `UserStreamBackfillWithDerivedStateResult`.
migration: No app calls these exports; nothing to change.
-->

The shared building blocks drop the stream-tenant backfill subpath.

<!-- kumiko-changes
feature: shared
type: breaking
title: shared/stream-tenant-backfill subpath removed
detail: The subpath `@cosmicdrift/kumiko-bundled-features/shared/stream-tenant-backfill` and its exports `backfillAggregateStreamTenants`, `StreamBackfillCandidate`, `StreamBackfillFailure`, `StreamBackfillOptions`, `StreamBackfillResult`, `StreamTenantTarget` are removed, as are the shared barrel exports `createSearchBucketCleanup`, `DerivedStateMode`, `rebuildAndReindex`, `StreamBackfillStepFailure` and `stepFailures`.
migration: No app imports them; nothing to change.
-->
