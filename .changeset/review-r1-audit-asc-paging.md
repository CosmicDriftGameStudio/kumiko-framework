---
"@cosmicdrift/kumiko-bundled-features": patch
---

Audit list pages forward without repeats when sorted ascending

`audit:query:list` with `sortDirection: "asc"` returned the same rows again on the next page because the cursor always meant "older than". The cursor now follows the sort direction, and ties are broken by event id. Sorting by `type` returns a single page without `nextCursor`, since an event id cannot resume a type-ordered listing.

<!-- kumiko-changes
feature: audit
type: fix
title: Audit list paging no longer repeats rows with ascending sort
-->
