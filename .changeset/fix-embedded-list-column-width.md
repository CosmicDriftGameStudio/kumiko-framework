---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix `EmbeddedListInput` desktop table columns collapsing below their declared width (e.g. a typed digit clipped in a number cell) instead of triggering the existing horizontal scroll. `w-full` on the vendored `Table`'s `<table>` forced `table-layout: auto` to squeeze columns to fit the container; the table now keeps `min-w-max` so columns retain their `columnWidthClass` width and the wrapper scrolls instead. Fixes solon#107.
