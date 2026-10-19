---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

actionForm successLinks and resetOnSuccess, field placeholder

An `actionForm` takes `successLinks` (`{ screen, idFrom, label }[]`, exclusive with `redirect`): after a successful submit the screen stays and shows the success box (`successMessage`, default "Done.") with one link per entry. Targets resolve like `redirect`; the id comes from the handler's success payload, and a link to a record screen without a string id is hidden. `resetOnSuccess: true` resets the form to its initial values after a successful submit while the screen stays put. The box disappears with the next edit or submit.

`EditFieldSpec.placeholder` (i18n key, literal as fallback) sets the empty-input hint of single-line text, number and textarea fields on every screen type with edit fields; other field kinds ignore it.

<!-- kumiko-changes
feature: framework
type: improvement
title: actionForm successLinks and resetOnSuccess
detail: successLinks keeps the actionForm open after a successful submit and lists links resolved like redirect; boot rejects it together with redirect or with an unknown target. resetOnSuccess clears typed values after success. Role projection drops links to screens the role cannot reach.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Success box with links, form reset and field placeholder
detail: The actionForm success box shows the default text "Done." (kumiko.actionForm.success) next to successMessage links, resetOnSuccess remounts the form with its initial values, and EditFieldSpec.placeholder reaches text, number and textarea inputs.
-->
