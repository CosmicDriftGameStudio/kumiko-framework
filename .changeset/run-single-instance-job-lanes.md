---
"@cosmicdrift/kumiko-dev-server": minor
---

`runProdApp` now boots `createAllInOneEntrypoint` by default (single-instance), running BOTH job lanes (api + worker) and the event-dispatcher inline. Previously it used `createApiEntrypoint` + `runLocalJobs`, which only consumed the **api** lane — so worker-lane crons (e.g. the GDPR data-export `run-export-jobs`, default `runIn:"worker"`) were silently never scheduled and stayed pending forever in single-container deploys.

New `runSingleInstance` option (default `true`); set `false` only with a dedicated worker deployment (then this process is api-only and the worker must run the worker lane + MSPs). The old `jobs.runLocalJobs` runProdApp option is removed (it was internal-only); `eventDispatcher.disabled` is honoured as `runSingleInstance:false` for back-compat.
