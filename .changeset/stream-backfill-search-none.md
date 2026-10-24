---
"@cosmicdrift/kumiko-server-runtime": minor
---

`runProdApp` and `runWorkerApp` accept `search: "none"` for apps without a search backend. The stream-tenant backfill then moves the legacy streams and rebuilds the projections without a reindex, instead of waiting forever for a process with a search adapter. Without the option the behaviour is unchanged: a process without a search adapter defers the backfill of searchable entities. `search: "none"` together with a `searchAdapter` in `extraContext` fails the boot.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: search "none" lets apps without a search backend run the stream-tenant backfill
detail: The backfill deferred itself in every process without a search adapter, so apps with a searchable tenant entity but no search backend (for example publicstatus) never moved their legacy tenant streams.
migration: |
  Apps without a search backend set `search: "none"` on runProdApp and runWorkerApp, otherwise the stream-tenant backfill stays deferred.
-->
