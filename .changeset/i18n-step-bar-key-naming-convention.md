---
"@cosmicdrift/kumiko-renderer": patch
---

Renamed the i18n key `kumiko.widget.stepBar.done` to `kumiko.widget.step-bar.done` (all other widget keys are kebab-case) and moved it from the wizard section to the widgets section in both the `de` and `en` blocks, next to the other `kumiko.widget.*` keys. `StepBar`'s screen-reader "Done" label now reads from the renamed key.

If an app overrides this specific key via `clientFeatures.translations`, update the key name — the old key is no longer read and its override would silently stop applying.
