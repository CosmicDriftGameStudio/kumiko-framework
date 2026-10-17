---
"@cosmicdrift/kumiko-framework": patch
---

Correct the release note on .d.ts handling in the pii-personal-migration codemod

<!-- kumiko-changes
feature: framework
type: fix
title: The pii-personal-migration codemod skips .d.ts files in migration mode too
detail: An earlier release note said the codemod now skips .d.ts files in --report-stance mode. That mode already skipped them. What changed is that migration mode skips .d.ts files as well, matching --report-stance.
-->
