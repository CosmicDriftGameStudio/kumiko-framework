---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

pagedListSchema and pageRows for in-memory projectionList queries, tenant-caps:list pages by offset

`pagedListSchema(sortableFields)` is the query schema for a projectionList whose rows are merged in memory: `limit`, `offset`, `search`, `sort` (enum of the sortable fields), `sortDirection` and `totalCount`. `pageRows(rows, request, { searchFields, defaultSort })` searches case-insensitively, sorts (missing values last, ties by `id`), slices by `offset` and `limit`, and returns a `CursorResult` with `nextCursor: null` and `total` only when `totalCount` is set.

`cap-overview:query:tenant-caps:list` now uses them. The projectionList pager sends `offset` and never a cursor, so every page used to show page 1. The query no longer pages by `cursor`: a caller that still sends one gets a 400 validation error instead of page 1 (`pagedListSchema` rejects `cursor`). An unknown `sort` is rejected by the schema.

<!-- kumiko-changes
feature: framework
type: improvement
title: pagedListSchema and pageRows for in-memory list queries
detail: pagedListSchema(sortableFields) and pageRows(rows, request, { searchFields, defaultSort }) cover search, sort (missing values last, ties by id), offset paging and an optional total for projectionList queries over merged rows. PagedListRequest and PagedListRowValue are exported; nextCursor is always null.
-->

<!-- kumiko-changes
feature: cap-overview
type: breaking
title: tenant-caps:list pages by offset and rejects cursor
detail: The cap overview list showed page 1 on every page because the pager sends offset and the query only read cursor. tenant-caps:list now takes offset like the pager; a cursor in the payload is rejected with a 400 validation error and sort is an enum of the sortable fields. The unused cap-overview.errors.invalidCursor and sortFieldUnsupported keys are gone.
migration: Callers of cap-overview:query:tenant-caps:list must send offset instead of cursor, and only a sortable field name as sort. Apps that override the removed i18n keys cap-overview.errors.invalidCursor or cap-overview.errors.sortFieldUnsupported can delete them. No caller in the kumiko-enterprise, kumiko-platform, kumiko-studio or app repos sends a cursor or defines these keys.
-->
