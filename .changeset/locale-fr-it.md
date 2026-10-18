---
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

French and Italian UI and mail copy

Two new opt-in packages ship French and Italian copy for the framework screens and mails. Mount `localeFr()` + `localeFrClient()` or `localeIt()` + `localeItClient()`; for mail copy only, call `registerMailTranslations("fr", localeFrBundle)` (or `"it"` with `localeItBundle`).

<!-- kumiko-changes
feature: locale-fr
type: improvement
title: New opt-in package kumiko-locale-fr ships French framework copy
detail: Same shape as kumiko-locale-es; not included by includeBundled.
-->

<!-- kumiko-changes
feature: locale-it
type: improvement
title: New opt-in package kumiko-locale-it ships Italian framework copy
detail: Same shape as kumiko-locale-es; not included by includeBundled.
-->
