---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": patch
---

Board gaps round 11: drawn icons for all apps, facet labels, empty list header, short forms for card sentence, step title and banner, bell in the menu.

<!-- kumiko-changes
feature: renderer
type: improvement
title: board gaps round 11, drawn icons, facet labels, empty list header, short forms, bell in the menu
detail: Visible change for all apps: the search, sparkles, wand and pencil icons (`Icon` keys `search`, `sparkles`, `wand`, `pencil`), the list search field, the nav search and the filter toggle use new drawn icons, exported from renderer/web as `DrawnSearch`, `DrawnSparkles`, `DrawnPencil`, `DrawnFilter`, `DrawnWand`, `DrawnPanel`. `navStyle` plain shows `DrawnPanel` on every width instead of the hamburger. Facet triggers split "Label: " grey from the value in its own span (`facet-<field>-value`), the sort select too (`<testId>-value`); with `narrowFacets` pills an empty select shows the label only. New options - `NamedFilterFacetOptions.hideEmpty` (zero-hit entries leave the select, "all" and the active entry stay; the counts are requested without `showCounts`), `ListColumnHint.narrowField` (shorter sentence on the phone card), `RecordStep.narrowTitle`, `RecordNotice.narrowTitle` and `narrowText` (also `BannerProps`), `WorkspaceShell.notificationBellPlacement: "header" | "overflow"` (overflow moves the bell into the always-visible "…" menu). `narrowPlacement: "behind-filter"` now works on lists that do not fill their height (search and filter toggle share one row below sm). A `frame: "card"` list from sm up keeps its header row when empty, with the empty state in the same card. Boot rule `query/output-field-missing` also checks `hint.narrowField`; the projectionList count-acceptance rule also applies to `hideEmpty`.
-->
