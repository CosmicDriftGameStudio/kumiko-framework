---
"@cosmicdrift/kumiko-renderer": patch
---

Split DefaultInput, renderInput and RenderField into table-driven dispatchers with small per-kind renderers.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Table-driven field and input dispatch
detail: DefaultInput, renderInput, RenderField and the read-only field text dispatch over tables, and ReferenceInput keeps its query and create state in one hook. Rendered markup and behavior are unchanged.
-->
