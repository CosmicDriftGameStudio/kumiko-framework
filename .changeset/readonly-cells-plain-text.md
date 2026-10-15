---
"@cosmicdrift/kumiko-renderer-web": patch
---

`readOnlyCells` of an embedded list now render as plain, wrapping text (select and reference labels, formatted dates, numbers and money) instead of a disabled input that cut off longer values. The row grows with its content, in both the table and the mobile card layout.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Embedded list readOnly cells render as wrapping plain text
detail: A readOnly column shows the formatted value (option and reference labels, dates, numbers, money) as text instead of a disabled input, so long values wrap instead of being cut off.
-->
