---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Follow-ups to the system check. ProbeTextKeys is part of the readiness entry, the paid hint names the button, the search probe has its own failure text, and the latest run says why it is empty.

<!-- kumiko-changes
feature: readiness
type: improvement
title: The readiness entry exports ProbeTextKeys
detail: ProbeTextKeys comes from @cosmicdrift/kumiko-bundled-features/readiness next to ReadinessQueries and ReadinessWrites, so apps can name probe texts without a deep import.
-->

<!-- kumiko-changes
feature: readiness
type: improvement
title: The paid probe hint names the button
detail: readiness.probe.paid-not-requested now reads "Only via “Test AI extraction”" (de „Nur über „KI-Auslesen testen““), the label of the button that starts the paid run.
-->

<!-- kumiko-changes
feature: readiness
type: improvement
title: The search probe fails with its own text
detail: When the search service throws, the search probe fails with readiness.probe.search.unavailable ("The search service does not answer"). The raw error can name the search host, so it goes only to the server log. New key in all locale packages.
-->

<!-- kumiko-changes
feature: readiness
type: improvement
title: An empty latest run says why it is empty
detail: The latest results and the run detail show "The check is running. Results appear when it is done." while a run is running and "There is nothing to check for this tenant." when a finished run has no rows the caller may see, and "The run was stopped before it returned results." for an abandoned run. Without a run the old text stays. New keys readiness.screen.latest.running, readiness.screen.latest.nothing-to-check and readiness.screen.latest.abandoned in all locale packages.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: relatedList emptyState takes variants
detail: EditRelatedListSection.emptyState is a RelatedListEmptyStateSpec. Its optional variants list pairs a FieldCondition on the parent record with a title and description; the first matching variant replaces the default text, the action stays.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: The relatedList empty state follows the parent record
detail: RelatedListSection evaluates emptyState.variants against the parent record and shows the first matching text. The headless view model translates the variant texts.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: The i18n boot check covers emptyState variants
detail: Title and description keys of relatedList emptyState variants count as required surface keys, so a missing translation fails the boot check.
-->
