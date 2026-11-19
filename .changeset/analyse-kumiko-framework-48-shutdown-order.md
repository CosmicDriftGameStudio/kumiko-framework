---
"@cosmicdrift/kumiko-server-runtime": patch
---

`runProdApp` stops HTTP before the job drain and keeps the whole shutdown inside the signal budget.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Prod shutdown closes HTTP first and stays within the drain budget
detail: On SIGTERM the server used to drain jobs for the budget minus 5 s and then wait up to another 10 s for HTTP, which overran the default 25 s budget, exited 1 before the DB and Redis closed, and kept accepting requests while brokers were stopping. `stop()` now refuses new requests at once, closes open connections such as SSE after a grace of up to 5 s, then drains jobs, then flushes audits and closes connections. At the default 25 s the job drain gets 15 s; raise `KUMIKO_SHUTDOWN_DRAIN_TIMEOUT_MS` or `signals.drainTimeoutMs` for longer jobs.
-->
