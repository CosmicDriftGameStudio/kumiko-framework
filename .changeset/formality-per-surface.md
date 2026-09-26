---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
---

Formal or informal address per surface: FormalityProvider, `createPublicSurface({ formality })` and a `de-x-formal` bundle in locale-de

<!-- kumiko-changes
feature: renderer
type: improvement
title: Formal or informal address per surface
detail: |
  `FormalityProvider` (and `createPublicSurface({ formality: "formal" })`) makes `t()` look up `<locale>-x-formal` across all plugin bundles before the plain locale, so public pages can say "Sie" while the app keeps "du". `formalLocaleTag(locale)` builds the tag. locale-de now ships `de-x-formal` overrides for its framework strings. Only bundle lookups are affected: an app resolver that already knows a key answers first, and an app that overrides a framework key in plain "de" needs a matching "de-x-formal" entry for formal surfaces.
-->
