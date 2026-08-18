---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

`LanguageSwitcher` now resolves its `aria-label` and `title` from the `kumiko.nav.language` translation key instead of hardcoding the German string "Sprache", so the trigger's accessible name follows the active locale; this only works because `createKumikoApp` mounts `kumikoDefaultTranslations` as the last fallback into `LocaleProvider`, which the switcher relies on to resolve the key.
