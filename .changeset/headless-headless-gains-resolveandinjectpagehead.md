---
"@cosmicdrift/kumiko-headless": minor
---

headless gains resolveAndInjectPageHead/injectPageHead for per-request head injection

New apex exports: PageHeadMeta/PageHeadResolver/PageHeadSystemQuery types, injectPageHead (idempotent marker-based </head> splice), and resolveAndInjectPageHead (resolves a PageHeadResolver with a shared 300ms timeout, converts to ApexHead, renders via renderApexHeadTags, injects). Moved out of @cosmicdrift/kumiko-server-runtime (kumiko-framework#3026) so runDevApp and runProdApp share one resolve+inject call instead of two copies of the timeout/fallback logic; server-runtime re-exports the three types unchanged for existing consumers.

<!-- kumiko-changes
feature: headless
type: improvement
title: headless gains resolveAndInjectPageHead/injectPageHead for per-request head injection
-->
