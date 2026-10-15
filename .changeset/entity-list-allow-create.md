---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": patch
---

`entityList` accepts `allowCreate: false` to hide that list's "+ New" button and empty-state create action. Unlike `allowCreate: false` on an `entityEdit` screen, the entity's edit screen keeps its create branch, so a custom action can still open it with a prefill.

<!-- kumiko-changes
feature: types
type: improvement
title: EntityListScreenDefinition.allowCreate
detail: allowCreate false hides the list's create button and empty-state create action; the entity's edit screen keeps its create branch.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: entityList honours allowCreate false
detail: EntityListBody passes no onCreate when the list sets allowCreate false.
-->
