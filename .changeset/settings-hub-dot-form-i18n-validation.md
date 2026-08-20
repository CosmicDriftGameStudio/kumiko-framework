---
"@cosmicdrift/kumiko-framework": patch
---

Boot validation now catches missing translations for Settings-Hub generated screens/navs. `buildConfigFeatureSchema` labels every masked config key's generated nav entry and configEdit section with the dot-form key `${feature}.settings` (and `mask.title` values as field-label overrides) — `isI18nKey`'s colon-only check silently dropped these from the required-keys set, so a feature could ship a generated Settings screen whose label was never translated and boot stayed silent (fw#2260). If your app defines a feature with a human-writable masked config key, make sure `${feature}.settings` and every `mask.title` value are declared as translations, or boot now throws `[i18n] Settings-Hub: required translation key missing: "..."`.
