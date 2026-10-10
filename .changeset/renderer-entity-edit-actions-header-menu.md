---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

entityEdit actions can go into the header "..." menu via placement: "menu"

<!-- kumiko-changes
feature: renderer
type: improvement
title: entityEdit actions can go into the header "..." menu via placement: "menu"
-->

`EntityEditScreenDefinition.actions` entries accept `placement: "inline" | "menu"` (new types `EntityEditAction` and `EntityEditActionPlacement`). The default stays inline: the action renders with the secondary form actions in the footer. `"menu"` puts it into the header "..." menu ahead of copy-link and delete, with the same confirm dialog and busy lock as other menu items. Without a header menu (drawer, card form, shell without a header slot) a `"menu"` action falls back to a footer button. The role projection keeps `placement`.
