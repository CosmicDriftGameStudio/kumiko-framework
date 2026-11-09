---
"@cosmicdrift/kumiko-guards": patch
---

pre-push stops in a worktree that is not installed.

<!-- kumiko-changes
feature: guards
type: fix
title: pre-push stops in a worktree that is not installed
detail: `kumiko-pre-push` aborts before any check when it runs in a git worktree that has a `package.json` but no `node_modules`, and prints `bun install --frozen-lockfile` for that worktree. A main checkout is not affected.
-->
