---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

List screens navigate rows by keyboard by default; `table.keyboardNavigation: false` turns it off.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Keyboard row navigation is on by default in list screens
detail: `entityList`, `projectionList` and `relatedList` screens now make their rows one tab stop with ArrowUp/ArrowDown, Home/End and Enter, without a `table` block. Set `table: { keyboardNavigation: false }` to keep the old behaviour. A free `DataTable` outside a list screen stays opt-in.
-->
