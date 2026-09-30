---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-http": patch
---

kumiko-framework and kumiko-http are published as compiled JavaScript plus .d.ts

Both packages now ship `dist` (`.js` and `.d.ts`) instead of TypeScript source. Export keys are unchanged; only the targets behind them move to `dist`. `kumiko-framework` still ships `src/scripts/codemod` as source because `kumiko upgrade` runs those codemods with Bun. Runtime-only subpaths that import `bun` or `bun:*` (for example `./testing`) still need Bun.

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko-framework and kumiko-http are published as compiled JavaScript plus .d.ts
-->
