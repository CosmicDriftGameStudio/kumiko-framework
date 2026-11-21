---
"@cosmicdrift/kumiko-renderer": patch
---

A dashboard list panel column applies its declared `renderer` FormatSpec.

<!-- kumiko-changes
feature: renderer
type: fix
title: Dashboard list panels format dates and other FormatSpec columns
detail: A list panel column with `renderer: { format: "date" }` (or any other FormatSpec) showed the raw value, such as the ISO date `2026-11-16`. The table, the card view and the one-line panel now format it in the user's locale, as an entityList column does.
-->
