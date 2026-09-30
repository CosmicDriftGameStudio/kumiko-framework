---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

SearchAdapter gains an optional dropAllIndexes() for rebuilds on a persistent index

`dropAllIndexes()` deletes every tenant index the adapter owns and returns the count. The in-memory adapter clears all tenants; the Meilisearch adapter deletes all indexes under its prefix (and refuses an empty prefix) and resets its configured-tenant state so the next write recreates a filterable index.

<!-- kumiko-changes
feature: framework
type: improvement
title: SearchAdapter gains an optional dropAllIndexes() for rebuilds on a persistent index
-->
