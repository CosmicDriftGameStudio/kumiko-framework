---
"@cosmicdrift/kumiko-renderer": patch
---

A tab group of a detail screen shows its description line.

<!-- kumiko-changes
feature: renderer
type: fix
title: Tab description is rendered on groups tabs
detail: The `description` of a section with tabbed groups was dropped; only fields and relatedList tabs showed it. The outer card of a groups tab now renders it as its subtitle, also when a relatedList tab has no rows.
-->
