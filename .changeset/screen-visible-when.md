---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Screens take `visibleWhen` and `fallback`. Every screen definition accepts an optional `visibleWhen: { query, field, eq }` (the same `DashboardPanelVisibility` as dashboard screen panels) and an optional `fallback` (same-feature short id or `<feature>:screen:<id>`). `KumikoScreen` evaluates the condition before the screen content mounts, so it also applies when the screen is opened by URL. While the query loads only a loading banner shows. If the condition is not met or the query fails, the fallback screen renders, or without a fallback a standard notice (`kumiko.screen.unavailable`, en/de/es). The gate is UI only; handlers still enforce access. The boot validator checks the query, the output field and the fallback screen, and rejects a `fallback` without `visibleWhen`. Panels with `visibleWhen` behave as before and share the new `evalVisibleWhen` helper exported from the renderer.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Screens take visibleWhen and fallback
detail: |
  Any screen can gate itself on a query field with `visibleWhen`, including on direct URL access. Unmet or failed conditions render the `fallback` screen or a standard notice instead of the content. New i18n key: `kumiko.screen.unavailable`.
-->
