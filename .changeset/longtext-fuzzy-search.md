---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-testing": patch
---

Long text fields can be full-text searched (`find: "fuzzy"`), long values are split into pieces in Meilisearch, and the app reindexes affected entities on its first start.

<!-- kumiko-changes
feature: framework
type: improvement
title: longText find "fuzzy", chunked Meilisearch documents, buildSearchSnippet
detail: createLongTextField accepts find: "fuzzy" (no blind-index lookup, "exact" stays text-only); the decrypted value goes into the search document like any other searchable field. The Meilisearch adapter splits string fields over 8,000 characters into pieces cut at whitespace with about 200 characters of overlap, because Meilisearch indexes at most 65,535 word positions per attribute; nothing is cut off. Piece 0 keeps the document id every entity already had, further pieces are `<id>_c<n>` with _entityId and _chunk, the index gets distinctAttribute _entityId (an entity matches once) and the filterable attributes _entityId and _chunk. index/indexBatch delete leftover pieces of an earlier longer version, remove/removeBatch delete all pieces of an entity by filter. Default-configured indexes from before are upgraded on first use. New buildSearchSnippet(text, term, { radius }) from @cosmicdrift/kumiko-framework/search returns before/hit/after around the first hit. Also new: tryWithSessionAdvisoryLock (db) and the es-ops operation type search-reindex.
migration: None. On the first start after the update the app reindexes the affected entities in the background, no manual step. Set KUMIKO_SKIP_SEARCH_REINDEX=1 to skip it.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Boot-time search reindex when search fields or the document format change
detail: runProdApp and runWorkerApp start a background reindex (reindexEntity for every tenant that owns events) for each searchable entity whose search fingerprint, the sorted search fields plus the document format version 2, has no completion marker yet. The marker is a kumiko_es_operations row written only after a run without failing rows, so an aborted or failed run is retried on the next boot. A Postgres advisory lock lets one process run it while the others skip, and boot readiness does not wait for it. It needs a configured SearchAdapter in the process; KUMIKO_SKIP_SEARCH_REINDEX=1 opts out.
-->
