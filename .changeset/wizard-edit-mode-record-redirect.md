---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

A wizard that edits an existing record now shows each step as done by what the record already holds, and every step is a jump target. A fields step counts as done when its fields validate and at least one visible, editable field that is not a select or boolean has a value, or when the user passed it with Next. Jumping forward still validates the step you leave. Extension steps report completeness through the new `reportStepComplete` prop of `ExtensionSectionProps`. `StepBar` gets `doneSteps` and `selectableSteps`. Create-mode wizards are unchanged. A `writeHandler` record action on a projectionDetail or entityEdit screen gets an optional `redirect` (same forms as entityEdit `redirect`, a valid `returnTo` wins), and a delete action that removes the shown record now leaves the screen (`returnTo`, else `listScreenId` or the entity's list screen) instead of showing "record not found". The boot validator checks `redirect` targets on these actions.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Wizard editing an existing record shows data-based done state and allows jumping to any step; delete record actions leave the screen
detail: |
  Update-mode wizards compute done per step from the record (valid, non-empty fields, or passed via Next) and make every non-current step a jump target; forward jumps run the current step's validate gate. `ExtensionSectionProps.reportStepComplete` lets extension steps report completeness. `StepBar` gets `doneSteps` and `selectableSteps`. A writeHandler record action with `redirect`, or a delete of the shown record, navigates away (returnTo, redirect, listScreenId, entity list) instead of refetching.
migration: |
  Extension wizard steps in an entityEdit that edits an existing record should call `reportStepComplete(true)` (usually from an effect) once they hold their data, otherwise the step bar shows them as not done until the user passes them with Next. This also applies to singleton wizards (e.g. a company-setup wizard), whose steps now show done by data and are all jump targets; tests that assumed back-only chips must be updated. A delete writeHandler action on a projectionDetail or entityEdit now navigates away after success (returnTo, else listScreenId or the entity's list) instead of refetching into "record not found"; set `redirect` to choose another target. List row actions are unchanged.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: StepBar supports explicit done state and jumping to any non-current step
detail: |
  The default `StepBar` forwards the new `doneSteps` and `selectableSteps` props: an upcoming chip can be a button that shows its number, and done state no longer has to follow position.
migration: |
  No code change needed.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: RowActionWriteHandler gets an optional redirect for record actions
detail: |
  `redirect` takes the same forms as entityEdit `redirect` and is honored on projectionDetail and entityEdit header and section actions, not on list row actions.
migration: |
  No code change needed.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot validator checks redirect targets of writeHandler record actions
detail: |
  An unknown `redirect` screen on a projectionDetail or entityEdit action or section action fails boot, like entityEdit `redirect`.
migration: |
  If a writeHandler record action already carries a `redirect` that does not resolve to a registered screen, fix or remove it.
-->
