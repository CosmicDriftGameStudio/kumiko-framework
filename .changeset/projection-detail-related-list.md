---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

`projectionDetail` screens can now declare a `relatedList` section (`layout.sections[]`, `kind: "relatedList"`) — a read-only list of related records that runs its own query, independent of the screen's own detail query. Fields: `title`, `query` (fully qualified QN, same paged envelope as `projectionList.query`: `{ rows, nextCursor, total? }`), `columns` (`ListColumnSpec[]`), optional `parentParam` (query-payload key the shown record's id is passed under, default `"id"`), optional `pageSize`, and optional `rowClick: { entity, idColumn? }`. A row click resolves its navigation target via `detailFor` (same lookup `resolveTarget` already uses for `ObjectTarget` navigation) — no `screenId` is named on the section itself.

The boot-validator rejects: an empty/non-string `query`; a `rowClick.entity` with no screen anywhere declaring `detailFor` for that entity (error names the missing `detailFor` the same way `nav.ts`'s `resolveTarget` does); and a `relatedList` section inside a `mode: "wizard"` layout (a read-only list has no place in a stepped form). Extension sections remain rejected on `projectionDetail`, unchanged; `entityEdit`/`configEdit`/`actionForm` do not gain `relatedList` support.

The renderer's `RelatedListSection` component (`@cosmicdrift/kumiko-renderer`, also usable standalone) fetches via the section's own query and renders through `RenderList` with no toolbar, search, sort, or pagination controls — deliberately out of scope for this section type. `@cosmicdrift/kumiko-headless`'s `EditSectionViewModel` gains the matching `EditRelatedListSectionViewModel` variant so `computeEditViewModel` can pass the section through to the renderer unresolved (the section runs its own query at render time, not at view-model-build time).
