---
"@cosmicdrift/kumiko-headless": patch
---

`altLocalePath(pathname)` toggled only between `defaultLocale` and `prefixedLocales[0]`, so a router configured with a third prefixed locale (e.g. `es`/`en`/`de`) had no way to link directly to it. `altLocalePath` now takes an optional `targetLocale` param — `altLocalePath(pathname, targetLocale)` resolves the current page's path in that locale; omitting the argument keeps the existing binary-toggle behaviour unchanged.

`publicPath` also now rejects locale keys that only resolve via the prototype chain (e.g. `"__proto__"`, `"constructor"`) instead of returning a non-string value, hardening it for the now-broader range of caller-suppliable `locale` strings.
