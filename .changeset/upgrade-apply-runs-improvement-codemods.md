---
"@cosmicdrift/kumiko-framework": patch
---

kumiko-upgrade --apply runs the codemod of every pending entry, not only of breaking ones

<!-- kumiko-changes
feature: framework
type: fix
title: kumiko-upgrade --apply runs codemods of improvement entries too
detail: The apply step only ran codemods attached to breaking entries. The 0.368.0 entry that moves the test stack to kumiko-testing is an improvement with a codemod (testing-move), so `bun kumiko-upgrade --apply` skipped it and left the deprecated framework paths in place. Every pending entry with a codemod now runs, in version order; manual-migration reporting is unchanged. Apps whose marker is already at 0.368.0 no longer see that entry as pending, so they run `bun kumiko-upgrade --apply --from 0.367.0` once, or the codemod directly: `bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/testing-move.ts . --write`.
-->
