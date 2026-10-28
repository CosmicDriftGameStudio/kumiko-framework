---
"@cosmicdrift/kumiko-renderer": minor
---

Reference facets search on the server instead of listing only the first 200 rows.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Searchable reference facets
detail: A reference facet in entityList, projectionList and relatedList loads a page of options and a search field narrows them on the server (300 ms debounce), so values beyond the first page can be filtered by. Chosen values keep their label from a separate by-id request, also after a reload from the URL. A reference field with `optionsQuery` uses that handler for the facet. The 200-row warning is gone; `DataTableFacet` gets optional `onSearchChange` and `searching`.
-->
