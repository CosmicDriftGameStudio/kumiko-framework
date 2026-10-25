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

The paid system check run gets its own button next to "Start check", and the mail probe tests the platform sender when a tenant has no own mail provider.

<!-- kumiko-changes
feature: types
type: improvement
title: projectionDetail takes inlineActions
detail: ProjectionDetailScreenDefinition.inlineActions lists action ids that stay visible buttons next to the primary action in the page header instead of folding into the "More actions" menu. Without it the header behaves as before. The phone header keeps its single icon button.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: The boot check validates inlineActions
detail: Every id in a projectionDetail inlineActions list must name a declared action (or edit when the screen has an edit target), the same rule as primaryAction; an unknown id fails the boot.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: The detail header keeps inlineActions as buttons
detail: HeaderActionsBar takes inlineActionIds and renders those actions as buttons after the primary action; only the remaining actions go into the overflow menu, and no menu is shown when none remain.
-->

<!-- kumiko-changes
feature: readiness
type: improvement
title: The paid run is a button next to Start check
detail: The system check screen declares run-paid-check as an inline action, so "Test AI extraction" shows as a button beside "Start check" instead of in the "More actions" menu. It stays hidden while the app has no paid probes.
-->

<!-- kumiko-changes
feature: channel-email
type: improvement
title: channel-email publishes its app transport
detail: channel-email declares the emailAppTransport extension and registers its app transport under it; findEmailAppTransport(registry) returns that transport, or null when the app has none or does not mount channel-email.
-->

<!-- kumiko-changes
feature: mail-foundation
type: improvement
title: The mail probe tests the platform sender
detail: A tenant without its own mail provider now gets the test mail through the channel-email app transport, the sender its tenant-transport notifications fall back to. The probe reports mail-foundation.probe.send-test-mail.platform-accepted on success and mail-foundation.probe.platform-send-rejected when the platform server rejects it; it is skipped only when neither an own provider nor an app transport exists, and mail-foundation.probe.not-configured now reads "No email sending set up". New keys in all locale packages.
-->
