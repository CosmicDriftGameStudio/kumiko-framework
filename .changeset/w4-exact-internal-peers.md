---
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-guards": patch
---

Internal peer dependencies between the Kumiko packages are `workspace:*`, so publish pins them to the exact release version instead of an open range.

<!-- kumiko-changes
feature: cli
type: improvement
title: Internal peer dependencies are published as exact versions
detail: The peer dependencies between the Kumiko packages (cli, guards, bundled-features, testing) are workspace:* in the repo, so publish pins them to the release version instead of an open range.
-->
