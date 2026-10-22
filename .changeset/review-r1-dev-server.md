---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-cli": patch
---

Fix managed-file sync, static config parsing and boot cleanup.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Managed CI, app jobs and static config parsing
detail: The public ci.yml sets MEILI_URL and MEILI_MASTER_KEY for the Meilisearch service. App-owned workflow jobs with a trailing comment or a quoted name survive a sync. kumiko.config.ts with shorthand or spread siblings next to literal ports is read as defined instead of invalid.
-->

<!-- kumiko-changes
feature: server-runtime
type: fix
title: runProdApp releases connections when the boot fails
detail: A failing boot closes the database pools, the Redis client and the KMS adapter it already opened. The KMS health wait logs "KMS not reachable" instead of "database not reachable".
-->
