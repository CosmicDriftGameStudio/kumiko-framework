---
"@cosmicdrift/kumiko-renderer": patch
---

Split RenderEdit into state hooks, a submit pipeline and per-kind section renderers.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Split RenderEdit into hooks and per-kind section renderers
detail: RenderEdit composes focused hooks and builders for state, form, draft, wizard navigation and submit, and renders sections through per-kind functions. Rendered markup and behavior are unchanged.
-->
