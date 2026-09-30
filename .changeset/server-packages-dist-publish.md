---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

kumiko-server-runtime and kumiko-dev-server are published as compiled JavaScript plus .d.ts

Both packages now ship `dist` (`.js` and `.d.ts`) instead of TypeScript source. Export keys are unchanged; only the targets behind them move to `dist`. `kumiko-dev-server` keeps its `bin/*.ts` entrypoints (they still need Bun) and ships them together with `templates`; they now import through the new `@cosmicdrift/kumiko-dev-server/cli` export instead of reaching into `src`. `kumiko-server-runtime` now declares `ioredis` and `kumiko-dev-server` declares `zod` as dependencies, which their code already imported. `ioredis` is imported as a named `{ Redis }` so the class resolves under Node's ESM loader.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: kumiko-server-runtime and kumiko-dev-server are published as compiled JavaScript plus .d.ts
-->
