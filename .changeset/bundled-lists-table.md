---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`bundledLists` sets one DataTable `table` block for every list screen and relatedList section of the bundled features.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: bundledLists sets one table block for every bundled list
detail: composeFeatures takes bundledLists with a table block and an optional pinFirstColumn flag. The block is mixed into every entityList, projectionList and relatedList section of the bundled features, the foundation features user and tenant as well as the features an app mounts from @cosmicdrift/kumiko-bundled-features, before the boot validator runs. A key the screen sets itself wins, export is left out on relatedList sections, and pinFirstColumn pins the first visible column left where no column is pinned yet. grouping and totals are rejected in the shared block. App screens stay untouched. Features opt in with the new registrar method r.adoptsBundledLists(), which every bundled feature with lists calls and which feature packages such as Enterprise can call for their own lists; app features never do. No migration for apps. The option lives in AppConfig.bundledLists for the managed kumiko/schema.ts and in the run options of runProdApp, runDevApp and runWorkerApp, so kumiko check and the running app see the same screens.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: validateBundledListsOptions and the BundledListsOptions type
detail: BundledListsOptions is exported from the types package and the engine barrel. validateBundledListsOptions rejects unknown keys, grouping, totals and pinFirstColumn without table.pinning with a message that names the key, and checks the remaining keys like a screen's own table block.
-->

<!-- kumiko-changes
feature: managed-pages
type: improvement
title: MANAGED_PAGES_FEATURE names the feature
detail: The barrel exports the MANAGED_PAGES_FEATURE constant so other code can refer to the feature name without a string literal.
-->

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: USER_DATA_RIGHTS_FEATURE is exported from the barrel
detail: The feature name constant that lived in web/constants.ts is now part of the public barrel.
-->
