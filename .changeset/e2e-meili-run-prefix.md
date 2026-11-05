---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": patch
---

App e2e runs no longer leave Meilisearch indexes behind. `defineAppE2eConfig` gives every run its own index prefix and drops exactly those indexes in a global teardown; `createMeilisearchAdapter` reads the prefix from `KUMIKO_MEILI_INDEX_PREFIX`.

<!-- kumiko-changes
feature: testing
type: fix
title: App e2e runs clean up their Meilisearch indexes
detail: Each run's server gets `KUMIKO_MEILI_INDEX_PREFIX=e2e_<uuid>_`, which beats the adapter's `indexPrefix` option, and a global teardown drops only that prefix. Without the variable the adapter behaves as before. A config that sets its own `globalTeardown` replaces this cleanup, so it has to include `config.globalTeardown`. Indexes of a run killed before its teardown stay behind. The framework's own Meilisearch tests now list all indexes in their cleanup instead of the first 20.
-->
