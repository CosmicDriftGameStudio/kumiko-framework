---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-cli": patch
---

`kumiko create` and `kumiko add feature` load only the scaffolder instead of the whole dev-server.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Scaffold subpaths for the CLI
detail: `@cosmicdrift/kumiko-dev-server/scaffold-feature` exports `scaffoldFeature` and `@cosmicdrift/kumiko-dev-server/scaffold-app-feature` exports `scaffoldAppFeature` and `runConfigPathForApp`. `kumiko create` and `kumiko add feature` import these subpaths, so they no longer load the dev-server barrel with its stack, schema and deploy code. The barrel still exports both functions.
-->
