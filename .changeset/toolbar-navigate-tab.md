---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
---

ToolbarAction's navigate variant gets `tab`, merged into the navigate search params and checked by the boot validator against the target projectionDetail's sections, same as RowActionNavigate.tab and MetricNavigate.tab (fw#3260)

<!-- kumiko-changes
feature: types
type: improvement
title: ToolbarAction's navigate variant gets `tab`
detail: |
  The navigate-kind ToolbarAction (entityList, projectionList and
  relatedList-section toolbars) accepts `tab?: string`, the section id of the
  tab to activate on the target projectionDetail (layout.mode "tabs"),
  analogous to RowActionNavigate.tab and MetricNavigate.tab.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Toolbar navigate actions merge `tab` into the search params
detail: |
  buildNavigateToolbarAction (shared by entityList, projectionList and
  relatedList-section toolbars) sets `tab` in the same params object as any
  declared `params`/prefill, so it lands in the single navigateWithReturnTo
  call next to returnTo.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot validator checks the target tab of toolbar navigate actions
detail: |
  A ToolbarAction with kind "navigate" and `tab` fails boot when its target
  is not a projectionDetail with layout.mode "tabs" or has no section with
  that id. The check covers entityList, projectionList and relatedList
  section toolbars.
-->
