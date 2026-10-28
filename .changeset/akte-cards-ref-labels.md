---
"@cosmicdrift/kumiko-renderer": patch
---

Read-only reference values and the reference combobox resolve the stored record by id, so a record beyond the first 50 rows of the target entity shows its label instead of its raw id.

<!-- kumiko-changes
feature: renderer
type: fix
title: Reference labels resolve by id beyond the 50-row cap
detail: ReadOnlyReferenceValue and the reference combobox request the stored ids (ids for directory sources, an id-in filter for entity list handlers) instead of scanning the first 50 rows. The caller's read rights still apply because the filter only narrows the list query. refOptionsQuery handlers keep the previous capped payload, and sources that ignore both inputs keep the previous capped-list behaviour.
-->
