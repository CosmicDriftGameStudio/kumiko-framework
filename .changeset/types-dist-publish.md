---
"@cosmicdrift/kumiko-types": patch
---

kumiko-types is published as compiled JavaScript plus .d.ts

The package now ships `dist` (`.js` and `.d.ts`) instead of TypeScript source. Export keys are unchanged; only the targets behind them move to `dist`. Consumers on plain Node ESM can import every subpath without a TypeScript-aware loader.

<!-- kumiko-changes
feature: types
type: improvement
title: kumiko-types is published as compiled JavaScript plus .d.ts
-->
