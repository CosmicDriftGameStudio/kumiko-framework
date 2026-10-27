---
"@cosmicdrift/kumiko-guards": patch
---

The pre-push worktree branch runs its steps in parallel lanes instead of one after another, so a push waits for the slowest step instead of the sum of all.

<!-- kumiko-changes
feature: guards
type: improvement
title: pre-push runs its worktree steps in parallel
detail: The worktree branch without check-wt.sh now hands typecheck, lint, test, the guard suites, comment-lang and public-exports-changelog to the new run-steps-parallel.ts next to the hook. test:dom stays behind test in the same lane, every step still runs after a failure, and each step's output is printed as one block when it finishes. The failure line keeps its form (worktree check failed: <steps>). The pool follows the free CPU capacity with a floor of four lanes; KUMIKO_PRE_PUSH_POOL overrides it.
-->
