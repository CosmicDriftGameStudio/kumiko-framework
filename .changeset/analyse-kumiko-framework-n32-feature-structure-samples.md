---
"@cosmicdrift/kumiko-guards": patch
---

The app-feature-structure guard also checks the framework's sample apps and recipes.

<!-- kumiko-changes
feature: guards
type: improvement
title: app-feature-structure covers samples
detail: In the framework repo the guard now scans `samples/apps/*/src/features/**` and `samples/recipes/*/src/**`. A recipe's `src/` folder counts as one feature folder, so `src/feature.ts` over 300 lines, a `src/web.ts(x)` monolith and JSX directly in `src/` are flagged like in an app feature. The sample features that broke the rules now keep handlers in handlers/, entities in schema/ and screens in screens.ts, and the styleguide clients moved from `web.ts(x)` to `web/index.ts`.
-->
