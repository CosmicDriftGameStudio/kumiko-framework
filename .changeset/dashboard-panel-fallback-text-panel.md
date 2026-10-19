---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Dashboard screen panels get a fallback, new static text panel

A dashboard `screen` panel takes `fallback` (same-feature short id or `<feature>:screen:<id>`): when `visibleWhen` is unmet or its gate query fails, that screen is embedded in the panel's place, with the same `label` and `chromeless`. While the gate loads nothing renders. The boot validator requires `visibleWhen` for it, resolves the target like the panel's own screen and rejects a target that has its own `visibleWhen`. Extension-selector owner panels qualify a short `fallback` like `screen`, and a role without access to the fallback screen gets the panel without it.

The new `text` panel (`DashboardTextPanel`) renders static `blocks`: `heading`, `paragraph` (`emphasis` muted or strong), `list`, `code` (verbatim, scrollable) and `hint`. `text` and list items are i18n keys and are checked as required translation keys; `visibleWhen`, `span` and an optional `label` work as on other panels.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Screen-panel fallback and static text panel
detail: A dashboard screen panel embeds its fallback screen when visibleWhen is unmet or the gate query fails (nothing while loading). The new text panel renders heading, paragraph, list, code and hint blocks from i18n keys, without markdown or HTML.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot validation for screen-panel fallback and text panels
detail: DashboardScreenPanel.fallback needs visibleWhen and a registered, embeddable target without its own visibleWhen. DashboardTextPanel (kind "text", exported with DashboardTextBlock) rejects empty blocks and empty lists; its text keys are required translation keys. Extension-selector panels qualify a short fallback ref, and role projection drops a fallback the role cannot reach.
-->
