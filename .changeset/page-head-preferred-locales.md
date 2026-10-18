---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

`resolvePageHead` receives the request's preferred locales

The resolver input gains `preferredLocales`: an ordered, canonicalized, deduplicated list with a valid `?lang=` first, then every Accept-Language tag by q (q=0 and malformed tags dropped, header order breaks ties). A resolver can walk it and use the first locale it has content for, instead of parsing the header itself. `runProdApp`, `runDevApp` and `hostDispatch` pages all pass it. `@cosmicdrift/kumiko-framework/i18n` exports `rankAcceptLanguage` and `rankPreferredLocales`; `pickAcceptLanguage` behaves as before. With a page-head resolver configured, `runProdApp` HTML responses send `Vary: Host, Accept-Language`, so a shared cache keeps the locale variants apart.

<!-- kumiko-changes
feature: headless
type: improvement
title: resolvePageHead gets preferredLocales (?lang= first, then Accept-Language by q) so resolvers can pick a content locale
detail: Callers constructing PageHeadResolveInput themselves must now pass preferredLocales (an empty array when no preference is known).
-->
