---
"@cosmicdrift/kumiko-framework": patch
---

`defineFailureReasons` keeps a feature's reason slugs, i18n keys and texts in one table.

<!-- kumiko-changes
feature: framework
type: improvement
title: defineFailureReasons ties reason slugs to their i18n texts
detail: `defineFailureReasons("orders", { alreadyPaid: { en: "…", de: "…" } })` returns `reasonOf(name)` (the snake_case slug, `already_paid`), `translationKeys` (`orders.errors.alreadyPaid` with its texts, for `r.translations({ keys })` and the client bundle) and `fail(name, details?, i18nParams?)`, a 422 `WriteFailure` whose `details.reason` is the slug and whose `i18nKey` is the matching key. A handler failure then always carries a translated text, and slug, key and text cannot drift apart. The error-contract recipe uses it.
-->
