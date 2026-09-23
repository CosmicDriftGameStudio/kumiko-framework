---
"@cosmicdrift/kumiko-guards": minor
---

kumiko-pre-push runs a worktree's own package.json scripts instead of the parent check on the main checkout

A push from a .wt/<name> worktree under the parent workspace without a tracked scripts/check-wt.sh used to fall into the parent-scoped kumiko check, which checks the main checkout of that repo, not the pushed worktree. It now runs the worktree's own typecheck, lint, test and test:dom scripts (whichever are declared) in the worktree, collects failures and refuses the push if any fail or if no test script exists. A tracked scripts/check-wt.sh still takes precedence; regular checkouts keep the parent-scoped check.

<!-- kumiko-changes
feature: guards
type: improvement
title: kumiko-pre-push runs a worktree's own package.json scripts instead of the parent check on the main checkout
-->
