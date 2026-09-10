---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

fw#2722 (remaining scope — Card-Rahmen already shipped separately): a `relatedList` section can now sort and no longer stretches the page.

**Sorting.** `ListColumnSpec` gains a `sortable?: boolean` flag and `EditRelatedListSection` gains `defaultSort?: ListSortSpec` — declared per-column, the same shape `entityList.defaultSort` uses, and validated the same way at boot (`defaultSort.field` must name a listed, `sortable: true` column, or the app fails to boot). Both are opt-in: a `relatedList` section that declares neither behaves exactly as before.

Sorting is applied **client-side**, over the rows already loaded for the section. Unlike `entityList`/`projectionList`, a `relatedList` section has no pager at all — one one-shot fetch, no cursor, no `onReachEnd` — so the loaded rows already are the full display set; sorting only that set client-side cannot hide a row that would otherwise be on "another page". Sending the sort to the server instead would need pagination this section doesn't have, so it was not built for this PR.

**Height.** A `relatedList` section in a tabs-mode Akte (the layout that already hides the section title, `hideSectionTitles: true`) now renders inside a bounded, internally-scrolling table instead of growing the whole page — the concrete complaint (a 40-row Akte tab pushing the page and making the record unusable) is fixed. `DataTableProps`/`RenderListProps` gain a `scrollBody` flag (off by default, so `entityList` and `projectionList` are unaffected); `RelatedListSection` sets it under the same condition it already sets `chromeless` under. Kept deliberately narrow: making the *whole* page-to-table height chain flex-aware (`app-layout.tsx` → `FormRoot`/`FormScreenShell` → the list) would touch components shared with non-tabs forms and standalone settings screens outside Akten, for a fix the issue itself scopes to tabs — a fixed-height scroll region on the table's own wrapper reaches the same outcome without any of that shared-surface risk.

Not included: search/facets on `relatedList` (`ListFacetSpec`, as `projectionList` has it). Doing this properly would mean replacing `RelatedListSection`'s synthetic minimal entity (a `{ type: "text" }` field per column, with no real query-schema/facet metadata behind it) with genuine reuse of the `projectionList` path — a structural rebuild out of scope for this PR. Left for a follow-up ticket.

https://claude.ai/code/session_0135cRvFdyV956Aae8PxyyDd
