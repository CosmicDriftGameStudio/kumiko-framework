---
"@cosmicdrift/kumiko-framework": patch
---

Server-side `t()` from `createI18n` falls back from a region tag to its base language.

<!-- kumiko-changes
feature: framework
type: fix
title: Server translations fall back to the base language
detail: Request locales arrive as canonical tags such as `en-US`. `createI18n(registry, { defaultLocale }).t(key, locale)` went straight to the default locale when no text existed for the full tag, so an English request got German texts, and apps wrote their own per-feature lookup helpers to strip the region. It now tries the full tag, then the base language, then the default locale; plural rules follow the locale the text came from.
-->
