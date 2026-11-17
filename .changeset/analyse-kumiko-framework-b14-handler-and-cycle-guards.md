---
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-feature-ast": patch
---

New ratchet guards `Handler Definitions` and `Feature Import Cycles`; the feature-layout codemod moves root-level `<name>.write.ts`/`<name>.query.ts` into `handlers/`.

<!-- kumiko-changes
feature: guards
type: breaking
title: Handler layout and feature import cycles are guarded
detail: `kumiko-guards guards` now runs `Handler Definitions` (handler definitions outside `<feature>/handlers/`, several handlers per file, a wrong `.write`/`.query` suffix, object literals typed `WriteHandlerDef`/`QueryHandlerDef`) and `Feature Import Cycles` (static, non-type-only imports that close a cycle between features). Both freeze existing hits per file in `.kumiko-handler-definitions-baseline.json` and `.kumiko-feature-import-cycles-baseline.json`. A missing baseline counts as empty, so every existing hit fails until the baseline is written. The feature-layout codemod now also moves `<name>.write.ts` and `<name>.query.ts` from a feature root into `handlers/` and rewrites their imports.
migration: Run the codemod, then `kumiko-guards guards --write-baseline --guard="Handler Definitions"` and `kumiko-guards guards --write-baseline --guard="Feature Import Cycles"` and commit both baseline files.
codemod: scripts/codemod/feature-layout.ts
-->
