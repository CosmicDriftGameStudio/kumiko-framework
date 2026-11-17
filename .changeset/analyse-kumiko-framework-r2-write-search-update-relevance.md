---
"@cosmicdrift/kumiko-framework": patch
---

The search consumer skips reindexing an update that changes no searchable field.

<!-- kumiko-changes
feature: framework
type: improvement
title: Updates reindex only when a search field changes
detail: An update event whose changes touch no searchable or embedded searchable field no longer rebuilds the search document. Entities with a search payload extension and events without a changes object still reindex on every update.
-->
