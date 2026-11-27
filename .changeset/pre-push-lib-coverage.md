---
"@cosmicdrift/kumiko-guards": patch
---

Worktree pre-push runs test:lib-coverage when the package declares it

The hook runs `test:lib-coverage` after `test` and `test:dom` in the same lane, so per-file coverage thresholds fail before CI does. Packages without the script see it reported as skipped.

<!-- kumiko-changes
feature: guards
type: improvement
title: Worktree pre-push runs test:lib-coverage when the package declares it
-->
