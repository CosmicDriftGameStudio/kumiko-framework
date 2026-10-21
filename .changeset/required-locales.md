---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Apps can require every translation key to exist in a fixed set of locales.

<!-- kumiko-changes
feature: framework
type: improvement
title: requiredLocales boot option
detail: `validateBootOptions.requiredLocales` (also `VALIDATE_BOOT_OPTIONS` in kumiko/schema.ts) makes boot fail when any translation key of the mounted features lacks one of the listed locales. Locales are combined across features, so locale packages close the gaps of the features they translate. Without the option nothing changes. This replaces the locale list the i18n-keys guard read from `src/i18n-guard-locales.ts` until 0.384.0; without that file it checked `["de", "en"]`.
migration: Define the option once, e.g. `{ requiredLocales: ["de", "en"] }`, pass it as `validateBootOptions` wherever the app boots (`runProdApp`, `runDevApp`, workers) and re-export it as `VALIDATE_BOOT_OPTIONS` from `kumiko/schema.ts` so `kumiko-schema validate` checks it in CI. The check covers framework and bundled keys too; a key missing a locale fails boot with the feature and key named.
-->

<!-- kumiko-changes
feature: personal-access-tokens
type: improvement
title: patScopeOptionKey for translating token scope labels
detail: The scope labels personal-access-tokens generates from `scopes[domain].label` are English only. `patScopeOptionKey(domain, "read" | "write")` returns their translation key, so an app feature can add the other locales with `r.translations`.
migration: Apps that mount personal-access-tokens and set `requiredLocales` with a locale other than `en` translate each generated scope label (`read`, plus `write` where the domain offers it) under `patScopeOptionKey`.
-->
