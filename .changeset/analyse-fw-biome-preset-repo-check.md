---
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-cli": patch
---

`kumiko-guards checks` fails an app whose `biome.json` does not extend the Kumiko Biome preset.

<!-- kumiko-changes
feature: guards
type: improvement
title: biome-preset repo check for apps
detail: The check that `biome.json` extends `@cosmicdrift/kumiko-framework/biome` now runs as the `biome-preset` repo check in `kumiko-guards checks` (kind app). `kumiko check` keeps its lint-step failure and uses the same `repoExtendsFrameworkPreset` function, exported from `@cosmicdrift/kumiko-guards`.
-->
