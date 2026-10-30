---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Screen forms pack their fields in flow again, tab content sits 16px below the tab strip, and chromeless screen panels in dashboards get a section head.

<!-- kumiko-changes
feature: renderer
type: fix
title: Screen forms with declared columns pack fields in flow again
detail: Since the declared-columns change a screen form with columns >= 2 rendered as a real CSS grid, so narrow fields (date, select) sat in wide columns and the second column started mid-form. Flow layout is back for every form with flow set and ignores the declared column count, as before. The view-model field columnsDeclared is removed; select width sm:w-60 and full-width cells stay.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Tab content sits 16px below the tab strip
detail: projectionDetail with layout.mode tabs left about 10px between the tab strip and the tab content (the embedded list toolbar). The header region wrapper now tops that up to 16px in one place for every tab kind.
-->

<!-- kumiko-changes
feature: renderer
type: feature
title: Chromeless screen panels in dashboards carry a section head
detail: A dashboard panel kind screen with chromeless renders the embedded screen's title (panel label, else screen:<id>.title) and its translated description as a section head, separated from the previous panel by a divider and without extra indentation. The embedded form no longer renders its own title block, and its submit buttons sit left-aligned directly under the fields without a divider footer. The "All fields are required" hint needs at least two shown fields, a lone field keeps its own required mark. The "As of" stamp only shows when the dashboard has a panel that loads data (not only screen, text or custom panels). The account-security dashboard marks its panels chromeless, and the sessions screen my-sessions is now titled "Signed-in devices" with a description (de, en, es, fr, it).
-->
