---
"@cosmicdrift/kumiko-framework": patch
---

The search index follows an aggregate that tenant-handover moves to another tenant.

<!-- kumiko-changes
feature: framework
type: fix
title: Search documents move with a transferred aggregate
detail: The search consumer now handles `system:aggregate.transferred`: for a searchable entity it removes the document from the source tenant's index and indexes the moved row in the destination tenant. Before, a claimed row stayed findable in the source tenant and was missing from the destination tenant's search until a full reindex.
-->
