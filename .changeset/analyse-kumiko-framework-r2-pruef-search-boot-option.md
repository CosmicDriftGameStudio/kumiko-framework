---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

`runProdApp`, `runWorkerApp` and `runDevApp` take a `search` option that builds the Meilisearch adapter from the env.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: search boot option
detail: `search: { provider: "meili-env", indexPrefix? }` on `runProdApp`, `runWorkerApp` and `runDevApp` builds the Meilisearch search adapter from `MEILI_URL` and `MEILI_MASTER_KEY` and puts it into the extraContext of all three processes, so apps drop their own adapter wiring. Both variables are required and show up in the boot dry run (the key as a secret); a missing one aborts the boot instead of indexing into memory. The option and an `extraContext.searchAdapter` together abort the boot. The app needs `meilisearch` installed, the optional peer of the framework; without it the boot names the missing package.
migration: Replace a `searchAdapter` in `extraContext` (for example built with `createSearchAdapterFromEnv`) with `search: { provider: "meili-env" }` on runProdApp, runWorkerApp and runDevApp.
-->
