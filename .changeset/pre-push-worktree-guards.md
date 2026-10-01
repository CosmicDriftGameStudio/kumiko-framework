---
"@cosmicdrift/kumiko-guards": patch
---

The pre-push worktree branch without `scripts/check-wt.sh` also runs `kumiko-guards guards`, `kumiko-guards checks` and `kumiko-guard-comment-lang`, matching consumer CI.

<!-- kumiko-changes
feature: guards
type: improvement
title: worktree pre-push runs the consumer-CI guards
-->
