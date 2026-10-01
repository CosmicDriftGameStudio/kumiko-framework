---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

The phone header overflow is now a right-aligned menu (`role="menu"`, arrow-key navigation) instead of a full-width panel, and `ThemeToggle` renders as a labelled row inside it. `ThemeToggle` titles default to the new i18n keys `kumiko.theme.dark` / `kumiko.theme.light`. On phones, a list's primary toolbar action without `onCreate` moves into the page header as an icon button.

Inline embedded-list tables no longer squeeze reference, select and number columns: columns have realistic minimum widths (the table scrolls horizontally below their sum), widths sit on `<col>` so text and reference columns take the free space, and the sticky actions column fits its four buttons.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Phone header overflow is a right-aligned menu with labelled rows, primary list toolbar action moves into the header on phones
-->

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Embedded list tables keep readable column widths and scroll instead of squeezing, actions column fits its buttons
-->
