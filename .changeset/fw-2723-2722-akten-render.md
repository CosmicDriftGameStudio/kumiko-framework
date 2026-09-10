---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

fw#2723: `EntityEditScreenDefinition.description` / `ActionFormScreenDefinition.description` (and, by the same `RenderEdit` render path, `ProjectionDetailScreenDefinition.description`) now render as the form's subtitle, in the same visual slot a section's own `description` already fills. An i18n `screen:<id>.subtitle` key still wins when present; the field falls back to nothing (no empty subtitle) when neither is set. The existing use of `description` as agent/API metadata is unaffected. Bumped `minor` rather than `patch`: this makes a previously inert, already-shipped field visible in the UI for the first time — an author who set it purely as metadata now sees it rendered.

fw#2722 (partial — search/sort and list height are still open): a `relatedList` section in a tabs-mode Akte no longer shows a card frame around its table. The tab panel is already the visual boundary — a card nested inside it separated nothing further. `DataTableProps` gained a `chromeless` flag (off by default, so every other `DataTable` consumer — `entityList`, `projectionList` — is unaffected); `RelatedListSection` sets it whenever the enclosing layout already hid the section title (`hideSectionTitles: true`, tabs mode).

https://claude.ai/code/session_0135cRvFdyV956Aae8PxyyDd
