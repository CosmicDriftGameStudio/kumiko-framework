---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
---

i18n plural forms via Intl.PluralRules

<!-- kumiko-changes
feature: framework
type: improvement
title: Translation values may now be CLDR plural-form objects, resolved per locale with Intl.PluralRules
migration: |
  A translation entry's value type widens from `string` to
  `string | PluralForms`, so an existing `TranslationEntry` locale value can
  now also be an object with `one`/`few`/`many`/`other` (etc.) CLDR
  categories, where `other` is required:

  ```ts
  { de: { one: "{count} Status-Seite", other: "{count} Status-Seiten" } }
  ```

  `createI18n(...).t(key, locale, { count })` resolves the CLDR category for
  the given locale via a per-locale-cached `Intl.PluralRules` and interpolates
  `{count}`; it falls back to `other` when `count` is missing/non-finite, the
  locale tag is invalid, or `Intl.PluralRules` is unavailable (older Hermes).
  `mailT` and the renderer's `translateWithFallbacks` resolve plural values
  the same way, through the shared `resolveTranslationValue` helper.

  Existing string-only translations keep working unchanged. Code that reads
  values back out of a bundle (`TranslationBundle`, `TranslationsByLocale`,
  `TranslationEntry`) and annotates them as `string` no longer typechecks:
  annotate as `TranslationValue` (from `@cosmicdrift/kumiko-framework/ui-types`)
  or flatten with `translationValueOtherText(value)`.
-->
