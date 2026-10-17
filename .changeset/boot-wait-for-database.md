---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

App and worker boot wait for Postgres instead of crashing

<!-- kumiko-changes
feature: framework
type: fix
title: App and worker boot wait for Postgres instead of crashing
detail: runProdApp and worker processes now probe the database before the schema-drift check and retry with exponential backoff (1s to 15s, up to 90s) on transient connection errors such as too_many_connections or ECONNREFUSED. The KMS health check at boot retries the same way. Non-transient errors like auth failures still abort immediately.
-->
