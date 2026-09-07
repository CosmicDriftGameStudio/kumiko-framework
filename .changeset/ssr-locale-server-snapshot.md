---
"@cosmicdrift/kumiko-renderer": patch
---

Server-side renders now honour the locale resolver instead of always rendering English.

`getServerSnapshot` in `useLocale`, `useTranslation`, `useOptionalLocale` and `useOptionalTranslation` returned a hardcoded `"en"`. Because `useSyncExternalStore` calls `getServerSnapshot` both during actual server rendering and during the client's first hydration render, every `renderToStaticMarkup`-based render produced English markup no matter what the resolver reported. All four now reuse the same synchronous `resolver.locale()` computation as `getSnapshot`, so server and client snapshots agree for a given request and localized SSR markup renders in the resolved locale.
