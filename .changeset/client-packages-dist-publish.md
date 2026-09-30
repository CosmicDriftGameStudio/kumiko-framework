---
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

kumiko-headless, kumiko-dispatcher-live, kumiko-renderer and kumiko-renderer-web are published as compiled JavaScript plus .d.ts

The four client packages now ship `dist` (`.js` and `.d.ts`) instead of TypeScript source. Export keys are unchanged; only the targets behind them move to `dist`. `kumiko-renderer-web` still ships `src/styles.css` and `src/fonts` as source, because the stylesheet and the font server resolve them by path; its Tailwind `@source` list now also scans the compiled `dist` of renderer-web and renderer. `kumiko-renderer-web` now declares `kumiko-framework` and `kumiko-types` as dependencies, which its code already imported.

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko-headless, kumiko-dispatcher-live, kumiko-renderer and kumiko-renderer-web are published as compiled JavaScript plus .d.ts
-->
