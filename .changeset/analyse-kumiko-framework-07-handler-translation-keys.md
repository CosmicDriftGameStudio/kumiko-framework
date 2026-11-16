---
"@cosmicdrift/kumiko-framework": patch
---

New `handlerTranslationKeys()` builds the title, description and field-label keys of a feature's handlers from short handler names.

<!-- kumiko-changes
feature: i18n
type: improvement
title: Helper for handler translation keys
detail: Apps assembled handler title and field keys by hand from `qn(...)`, `handlerTitleKey` and `handlerFieldLabelKey`, and had to repeat the feature-name kebab-casing the registry applies. `handlerTranslationKeys(featureName, { writes, queries })` from `@cosmicdrift/kumiko-framework/engine` qualifies each short handler name the way the registry does and returns `TranslationKeys` to spread into `r.translations({ keys })`. Each handler takes a `title`, an optional `description` and optional `fields` labels.
-->
