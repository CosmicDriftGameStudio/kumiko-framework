---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

`navigateWithReturnTo` accepts entity ObjectTargets, so row navigate actions, legacy rowClick and the default detailFor row click now carry `returnTo` the same way screen targets already do (fw#3260)

<!-- kumiko-changes
feature: renderer
type: improvement
title: navigateWithReturnTo carries returnTo for entity ObjectTargets
detail: |
  navigateWithReturnTo now accepts a NavTarget (ScreenTarget or ObjectTarget),
  not just ScreenTarget. For an entity target it compares the resolved href
  against the host's to detect a self-navigate (no returnTo) and otherwise
  sets returnTo to the host snapshot, same as the existing screen-target
  path. runProjectionRowNavigate, buildNavigateRecordAction, EntityListBody's
  row navigate and related-list-section's legacy rowClick now go through
  this for entity actions.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: The default detailFor row click carries returnTo
detail: |
  create-app's default row click to a declared detailFor screen now calls
  navigateWithReturnTo with the current host, so navigating to an entity's
  detail screen from a list carries returnTo like every other navigate
  action already does.
-->
