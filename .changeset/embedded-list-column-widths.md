---
"@cosmicdrift/kumiko-renderer-web": patch
---

Inline tables size columns by type, the actions column stays visible, and long select labels truncate

The embedded-list table now fills the form field width instead of sizing to its content: number, money, date and select columns get a fixed width, text and reference columns take the free space. Wide tables scroll horizontally with the actions column pinned to the right edge. Combobox and select triggers keep a long selected label on one line, truncated with the full text as tooltip, instead of wrapping and centering it.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Inline tables size columns by type with a pinned actions column, long select labels truncate
-->
