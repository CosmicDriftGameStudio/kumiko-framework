---
"@cosmicdrift/kumiko-framework": minor
---

changes.json entries can set manualAfterCodemod so `kumiko-upgrade --apply` runs the codemod and still records the entry as pending manual migration

<!-- kumiko-changes
feature: framework
type: improvement
title: changes.json entries can set manualAfterCodemod to stay pending manual after the codemod ran
detail: |
  A codemod entry with `manualAfterCodemod: true` is recorded in `pendingManual` of `.kumiko/upgrade-state.json` in addition to the codemod run. Set it with `kumiko changes add --codemod <path> --manual-after-codemod`.
-->
