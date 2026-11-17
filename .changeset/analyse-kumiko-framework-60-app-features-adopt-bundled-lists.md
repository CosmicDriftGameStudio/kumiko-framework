---
"@cosmicdrift/kumiko-types": patch
---

App features can take the app-wide `bundledLists` table block by calling `r.adoptsBundledLists()`.

<!-- kumiko-changes
feature: framework
type: improvement
title: App features may adopt the bundledLists block
detail: `r.adoptsBundledLists()` is no longer reserved for bundled features and feature packages. An app feature that calls it gets the `bundledLists` table block and `pinFirstColumn` on all its entityList, projectionList and relatedList screens, like the bundled features, so an app with one table standard sets it once in `kumiko.config.ts` instead of wrapping every list. A screen's own `table` keys still win per key, and `export: undefined` on a screen drops the shared export for that list. Features without the call stay untouched.
-->
