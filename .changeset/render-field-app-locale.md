---
"@cosmicdrift/kumiko-renderer": patch
---

fix(render-field): forward the app i18n locale (`useLocale`) to money/date inputs. Previously they fell back to `navigator.language` (browser language) — `money` only honoured an explicit `field.locale`, `date`/`timestamp` passed no locale at all. When the app language differed from the browser language this caused a decimal-separator mismatch (comma vs. period). `field.locale` still overrides the app locale.
