---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Spanish (`es`) is now a first-class locale across the framework's own UI. Every translation table ships a third locale: the renderer defaults (save/cancel/delete, empty states, pagination, validation messages), the complete email-password login and MFA flows, and every bundled feature's screens, nav entries and field labels. Previously a Spanish-speaking user resolved to `es` through `navigator.language` and then fell through to the hardcoded `en` fallback, so the entire product read English no matter what the language switcher offered.

The per-file `LocalizedString` type now requires `es` alongside `de` and `en`, so a table cannot ship half-translated: the compiler rejects a missing locale rather than letting the bundle builder emit `undefined`. `LanguageSwitcher` no longer hardcodes the German string "Sprache" as its `aria-label` and `title`; it resolves `kumiko.nav.language` instead, so screen readers announce the control in the active language. The `kumiko new app` scaffold emits all three locales, so newly generated apps start out multilingual.

Apps are not forced to follow. The boot validator's completeness gate still requires only `de` and `en`, so an app that translates its own features into those two keeps booting unchanged, and any locale an app registers through `r.translations` continues to merge in without needing an entry in a framework list.
