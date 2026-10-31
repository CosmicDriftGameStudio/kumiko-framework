---
"@cosmicdrift/kumiko-framework": patch
---

dropAllIndexes copes with other clients deleting indexes on the same Meilisearch.

<!-- kumiko-changes
feature: search
type: fix
title: dropAllIndexes tolerates concurrent index deletions on a shared Meilisearch
detail: The Meilisearch adapter enqueues all index deletions of a drop together and treats an index another client already removed (index_not_found or the vanished index files) as dropped. When the index listing fails because another client is deleting an index, it waits for the deletions in flight and lists once more. The adapter's configured-tenant cache is cleared even when the listing fails.
-->
