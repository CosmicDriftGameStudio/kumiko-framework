---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

actionForm screens can confirm a submit with the chosen record

A new `successMessage` i18n key on an `actionForm` screen shows a confirmation above the form after a successful submit, for screens that stay put (no `redirect`, not in a drawer). `{field}` placeholders take the submitted values, and a `reference` field shows the chosen record's label instead of its id. The tier-engine admin form uses it: "Tier assigned: Acme → Pro", so choosing the wrong tenant is visible right away. New i18n key: `tier-admin.success` (en/de/es). `RenderEdit`'s `onSubmit` receives the submitted values as a second argument.

<!-- kumiko-changes
feature: renderer
type: improvement
title: actionForm successMessage names the chosen record's label after a successful submit
-->
