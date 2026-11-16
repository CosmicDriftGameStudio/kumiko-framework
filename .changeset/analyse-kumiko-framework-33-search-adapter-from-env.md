---
"@cosmicdrift/kumiko-framework": patch
---

Add createSearchAdapterFromEnv, which picks Meilisearch or the in-memory adapter from MEILI_URL and MEILI_MASTER_KEY.

<!-- kumiko-changes
feature: search
type: improvement
title: createSearchAdapterFromEnv
detail: @cosmicdrift/kumiko-framework/search/meilisearch exports createSearchAdapterFromEnv(env, { indexPrefix? }). With MEILI_URL and MEILI_MASTER_KEY both set it returns the Meilisearch adapter, with neither set the in-memory adapter, and with only one set it throws so a half-configured deploy fails at boot instead of indexing into memory. Apps can replace their own bin/search-adapter.ts with it.
-->
