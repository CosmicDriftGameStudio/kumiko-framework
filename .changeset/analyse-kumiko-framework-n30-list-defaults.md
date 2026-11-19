---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-feature-ast": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

`bundledLists` becomes `listDefaults` and reaches the lists of every composed feature; `r.adoptsBundledLists()` is removed.

<!-- kumiko-changes
feature: framework
type: breaking
title: listDefaults replaces bundledLists, adoptsBundledLists removed
detail: The app-wide table block is named `listDefaults` (AppConfig, `ListDefaultsOptions`, `validateListDefaultsOptions`) and applies to every entityList, projectionList and relatedList of every composed feature, app features included. `r.adoptsBundledLists()`, `FeatureDefinition.adoptsBundledLists` and the `adoptsBundledLists` field in feature-manifest.json are removed. The boot rules are renamed from `bundled-lists/*` to `list-defaults/*`.
migration: Rename `bundledLists` to `listDefaults` in kumiko.config.ts and the bin runner options, `BundledListsOptions` to `ListDefaultsOptions`, `validateBundledListsOptions` to `validateListDefaultsOptions`, and delete every `r.adoptsBundledLists()` call. App lists now get the block too; a screen that must differ sets its own `table` keys (`export: undefined`, `pinning: false`, `resizing: false`).
affects: bundledLists, BundledListsOptions, adoptsBundledLists, bundled-lists/
-->

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: composeFeatures listDefaults applies to all features
detail: `composeFeatures`, `runProdApp`, `runWorkerApp` and `composeAppFeatures` take `listDefaults` instead of `bundledLists`. The block no longer skips features without a marker; a screen's own `table` keys still win per key, and relatedList sections never get `export`.
migration: Rename the option to `listDefaults`. Remove per-screen wrappers that only repeated the app's table standard.
affects: bundledLists
-->

<!-- kumiko-changes
feature: dev-server
type: breaking
title: Managed kumiko/schema.ts and kumiko check read listDefaults
detail: The managed `kumiko/schema.ts` passes `appConfig.listDefaults` to `composeFeatures`, and `kumiko check` reports bin runners that leave out `listDefaults` while kumiko.config.ts sets it. `runDevApp` and `setupTestStackFromFeatures` take `listDefaults`.
migration: Run `kumiko sync-managed` to refresh kumiko/schema.ts, then rename the runner option in bin/.
affects: bundledLists
-->

<!-- kumiko-changes
feature: feature-ast
type: breaking
title: adoptsBundledLists pattern removed
detail: The parser, renderer, patch kinds, pattern-id and pattern-change schemas and the pattern library no longer know `adoptsBundledLists`; `AdoptsBundledListsPattern` and `adoptsBundledListsSchema` are no longer exported.
migration: Drop references to the `adoptsBundledLists` pattern kind.
affects: adoptsBundledLists, AdoptsBundledListsPattern, adoptsBundledListsSchema
-->
