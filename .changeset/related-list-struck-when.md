---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

A related list section can declare `struckWhen`, which greys out and strikes through the rows matching a field condition.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Related list rows can be struck through with struckWhen
detail: `struckWhen: { field, eq | ne | in | notIn }` on a relatedList section draws matching rows muted and line-through, for example a lost offer line. The row-action column stays readable so an undo action is still legible. `DataTableProps` gains `rowStruck`; renderers without it ignore it.
-->
