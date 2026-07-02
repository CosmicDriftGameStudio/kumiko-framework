---
"@cosmicdrift/kumiko-renderer": patch
---

Fix: `projectionList` screens now render their `toolbarActions`.

The `projectionList` screen-type declared `toolbarActions` in its schema, but `ProjectionListBody` never resolved or passed them to `RenderList` — so a declared toolbar button (e.g. a "New …" navigate action) silently didn't render. Now resolved analogous to `rowActions` (navigate-kind in v1) and passed through, matching `entityList` behaviour.
