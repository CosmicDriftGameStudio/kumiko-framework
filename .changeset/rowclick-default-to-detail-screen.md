---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

A row click on an `entityList` now defaults to the entity's declared detail screen (`detailFor`, fw#2163) when one exists — no `rowClick: true` rowAction needed. Precedence: an explicit `rowClick: true` navigate action still wins first, then the `detailFor` screen, then the app-wide `onRowClick` option (`createKumikoApp`), then the previous entityEdit-search fallback. Apps that never declare `detailFor` see no change. `projectionList` is unaffected (it has no resolvable entity).

Also fixes `resolveTarget`'s `{ entity, id }` navigation target (used by this default and by `relatedList` row clicks): it produced a fully-qualified `screenId` instead of the short form the router expects, so a resolved detail-screen navigation silently landed on the app's fallback screen instead. Screen short ids are boot-validated unique app-wide, so the short form alone is unambiguous.

`projectionList`'s "at most one `rowClick: true` rowAction" boot check (previously `entityList`-only) now also runs for `projectionList` screens.
