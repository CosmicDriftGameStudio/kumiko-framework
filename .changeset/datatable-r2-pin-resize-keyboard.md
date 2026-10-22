---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

The list `table` block gets `pinning`, `resizing` and `keyboardNavigation`, and columns get `pinned`, `width` and `minWidth`. This release carries the types, the boot validation, the remembered view state and the texts.

<!-- kumiko-changes
feature: framework
type: improvement
title: table.pinning, table.resizing and table.keyboardNavigation, column pinned, width and minWidth
detail: The boot validator rejects pinned without table.pinning, a pinned value other than left or right, width or minWidth without table.resizing, values that are not finite numbers above 0, and a minWidth above the width.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: remembered column pins and widths in the list view state
detail: useListTable passes pins, widths, minWidths and keyboardNavigation to the DataTable view options. Pins and widths live in the list-state store next to columns and density; a saved pin set replaces the schema pins, so a user can release a pinned column. New keys kumiko.list.view.pinning, kumiko.list.view.pin-left, kumiko.list.view.pin-right and kumiko.list.column.resize in all locale packages.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: DataTable resize grip, pinned focus ring and bounded widths
detail: Column widths stay between minWidth and 2000 px, also when read back from the session. The resize grip shows on header hover and focus and carries aria-valuenow, aria-valuemin and aria-valuemax. Pinned and actions cells repeat the keyboard focus ring, and a pressed pin button is highlighted.
-->
