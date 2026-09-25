---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
---

RowActionNavigate gets `tab`: navigate actions open the target projectionDetail on a given tab (fw#3254)

<!-- kumiko-changes
feature: types
type: improvement
title: RowActionNavigate.tab selects the tab on the target projectionDetail
detail: |
  Navigate row actions, screen/section actions and relatedList emptyState
  actions accept `tab?: string`, the section id of the tab to activate on the
  target projectionDetail (layout.mode "tabs"), analogous to MetricNavigate.tab.
  Example: `{ kind: "navigate", id: "edit-channels", label: "...",
  screen: "vehicle-detail", entityId: "vehicleId", tab: "channels" }`.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Navigate actions merge `tab` into the search params next to returnTo
detail: |
  Row, record and section navigate actions set `tab` in the same
  setSearchParams call as their `params` and `returnTo`, so the back
  navigation survives. Metric navigate with screen/entity plus tab now also
  lands in that single call instead of a second setSearchParams after it.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot validator checks the target tab of navigate actions
detail: |
  A navigate action with `tab` fails boot when its target is not a
  projectionDetail with layout.mode "tabs" or has no section with that id.
  The check covers list rowActions, relatedList rowActions, screen actions,
  section actions and relatedList emptyState actions.
-->
