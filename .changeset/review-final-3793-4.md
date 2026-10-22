---
"@cosmicdrift/kumiko-server-runtime": patch
---

`runProdApp` and `runWorkerApp` accept `databaseWait` (`sleep`, `now`, `log`) to replace the real clock of the boot backoff for the database and KMS waits. Tests use it to cover the retry path and the abort cleanup without real waiting.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Boot database backoff takes an injectable clock
detail: The new databaseWait option on runProdApp and runWorkerApp swaps sleep, now and the log sink of the database, KMS and seed waits. A worker boot against an unreachable database is now tested to retry until the deadline, abort with the connection error and close its Redis clients.
-->
