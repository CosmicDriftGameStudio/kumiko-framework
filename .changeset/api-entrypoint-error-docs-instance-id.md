---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

`runProdApp` passes `errorDocs` and `instanceId` to the server. `ApiEntrypointOptions` now carries both fields. Before, the entrypoint dropped them silently, so the `errorDocs` option of `runProdApp` had no effect and `KUMIKO_INSTANCE_ID` from its env source never reached the server. The boot-abort cleanup of `runProdApp` moved into a helper that also swallows synchronously throwing cleanups, and `wireDevAuth` now takes only the config fields it reads.

<!-- kumiko-changes
feature: framework
type: fix
title: runProdApp passes errorDocs and instanceId to the server
detail: ApiEntrypointOptions now carries errorDocs and instanceId and createApiEntrypoint forwards them to the server. Before, runProdApp dropped its errorDocs option and the KUMIKO_INSTANCE_ID from its env source. The boot-abort cleanup of runProdApp also moved into a helper that swallows synchronously throwing cleanups.
-->
