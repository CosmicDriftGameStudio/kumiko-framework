---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

New `projectionList` screen-type — like `entityList`, but bound to an explicit query instead of an entity.

`entityList` derives its list-query from the screen's own feature (`<feature>:query:<entity>:list`), so a screen can't list a projection owned by another feature. `projectionList` takes a fully qualified `query` verbatim (e.g. `ledger:query:schedule:list`) — cross-feature by design, and works over any read-model/aggregation, not just entities. Columns carry explicit labels (no entity to derive from), there's no auto create-navigation, and row interaction is explicit via `rowActions`. Reuses the entityList table machinery (RenderList/computeListViewModel) via a synthetic-entity shim; `entityList` is untouched. v1 renders the query rows with navigate row-actions/row-click (no server sort/pagination — a projection query has no guaranteed paged contract).
