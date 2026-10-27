---
"@cosmicdrift/kumiko-guards": patch
---

A push from a worktree with a wrapping `scripts/check-wt.sh` runs `pre-push-extra.sh`, the upgrade-state guard and the gitleaks scan once instead of twice. The worktree branch also runs the UI guards when `kumiko.json` declares `uiRoots`, as `kumiko check` does.

<!-- kumiko-changes
feature: guards
type: fix
title: pre-push runs its pre-flight steps once per push
detail: When the hook delegated to a tracked scripts/check-wt.sh that wraps the hook again, the inner run repeated pre-push-extra.sh, the upgrade-state guard and the gitleaks scan, and that second scan only covered HEAD because git's stdin was already read. A re-entry recognised by process ancestry now skips these steps; a check-wt.sh run by hand still runs them once. The worktree branch without check-wt.sh adds kumiko-guards ui when kumiko.json declares non-empty uiRoots, and in the repo that ships kumiko-guards it runs the checked-out packages/guards/src/cli.ts instead of a node_modules bin.
-->
