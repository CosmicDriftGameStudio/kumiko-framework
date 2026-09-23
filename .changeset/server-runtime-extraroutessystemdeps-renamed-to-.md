---
"@cosmicdrift/kumiko-server-runtime": minor
---

ExtraRoutesSystemDeps renamed to SystemWireDeps; hostDispatch gains systemQuery

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: ExtraRoutesSystemDeps renamed to SystemWireDeps; hostDispatch gains systemQuery
migration: |
  ExtraRoutesSystemDeps is renamed to SystemWireDeps and now backs the new wire hook instead of extraRoutes; WorkerWireDeps is derived from it. A consumer importing ExtraRoutesSystemDeps from server-runtime must switch to SystemWireDeps (same shape: db, redis, registry, dispatchSystemWrite). HostDispatchFn passed to runProdApp now takes a second argument { systemQuery } - a dispatch function reading db directly for routing decisions must switch to systemQuery.
-->
