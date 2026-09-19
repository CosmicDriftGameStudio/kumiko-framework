---
"@cosmicdrift/kumiko-bundled-features": minor
---

tenant-handover: try-before-signup ownership handover

New bundled feature: claims an anonymous run's declared-transferable entity graph (root plus parentRef-linked children) into a freshly signed-up account's tenant, legitimized by a row-bound grant. EntityDefinition gains an optional transferable flag; files-tenant-data's tenant-destroy hooks learn to handle handed-over fileRef rows (their bytes stay under the source tenant's storage prefix by design) on both sides.

<!-- kumiko-changes
feature: tenant-handover
type: improvement
title: tenant-handover: try-before-signup ownership handover
-->
