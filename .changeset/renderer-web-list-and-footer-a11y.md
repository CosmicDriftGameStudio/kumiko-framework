---
"@cosmicdrift/kumiko-renderer-web": patch
---

List boolean cells, row-click and hover tooltips, and the phone pinned footer behave consistently

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Boolean list cells announce Yes/No, hidden row clicks stay inert, tooltips follow the value, pinned footer picks the explicit primary
detail: Columns of type boolean without a renderer now render the accessible check mark with a Yes/No screen-reader label. The table branch evaluates the hidden rowClick action once per row. Meta-cell tooltips are refreshed on every hover and only set when the text is clipped. On phones the pinned footer prefers an explicitly marked primary action over a later submit button, moves a Back action without a determinable accessible name into the overflow, and shows the unsaved-changes badge on the primary button while the overflow trigger is not visible.
-->
