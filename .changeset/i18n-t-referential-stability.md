---
"@cosmicdrift/kumiko-renderer": patch
---

Fix `useTranslation()` returning a new `t` function reference on every render. `LocaleProvider`'s context value and the returned `t` are now memoized, keyed on resolver/fallbackBundles/fallbackLocale/locale identity.

This caused a production incident: `admin-shell` overview screens use `t` in a `useEffect` dependency array, and the referentially-unstable `t` triggered an infinite render/effect loop (~600 query requests/second against the server).
