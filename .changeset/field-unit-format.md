---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

Added a `unit` field formatter (`{ format: "unit", unit: "m2" | "km" | "m" | "kg" | "percent" }`) to `FieldFormatRegistry`/`applyFormatSpec`, so apps showing a value-with-unit on a detail page (e.g. `58 m²`) can declare `field.renderer` instead of hand-rolling an i18next `{{value}} m²` template. CLDR-sanctioned units (`km`/`m`/`kg`/`percent`) render locale-correctly via `Intl.NumberFormat({ style: "unit" })`; `m2` has no sanctioned ECMA-402 unit (`square-meter` throws `RangeError`), so it renders as a locale-formatted number with a literal `m²` suffix instead.

`RenderField`'s readOnly + declared-`renderer` path (`FieldRendererOutput`) now also defaults `locale` to the app's `LocaleProvider` locale when the `FormatSpec` doesn't set its own — previously it silently fell back to the JS runtime's default locale for every locale-sensitive format (`timestamp`/`date`/`number`/`decimal`/`bigInt`/`unit`), not just the new one. An explicit `renderer.locale` still wins, same precedence as `dateLocale` vs. app-locale elsewhere in the same component.
