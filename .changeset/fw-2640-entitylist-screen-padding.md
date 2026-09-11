---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

fw#2640: list screens now end at the same footer distance as every other screen. Form, custom and dashboard screens take their insets from the shared `screenPaddingClassName` token (`px-6 pt-6 pb-12`) via `FormScreenShell`/`PageSection`, but an `entityList`/`projectionList` screen has neither container around it — its screen chrome is `DataTable`'s own outer wrapper, which carried a symmetric `p-6`. A list therefore stopped 24px above the viewport edge while a form stopped 48px above it. `DataTableProps` gains `screenPadding`, set by `EntityListBody` and `ProjectionListBody` (via `RenderList`), which swaps that wrapper's inset for the same shared token — one screen-padding token for all screen types instead of a list-only inset.

The default is unchanged, so a `DataTable` embedded in a host that already provides its own boundary keeps the symmetric inset: `relatedList` sections (stacked and tabs mode alike) and app-side `<DataTable>` usages render exactly as before. A host sets `screenPadding` or `scrollBody`, not both — the wider bottom inset competes with the flex-fill height budget a tab-panel list depends on.
