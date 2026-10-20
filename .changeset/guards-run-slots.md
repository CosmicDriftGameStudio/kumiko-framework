---
"@cosmicdrift/kumiko-guards": patch
---

The full guard run now takes one of two local slots before it builds the project, so parallel pushes from several worktrees queue instead of running six memory-heavy guard runs at once. Set `KUMIKO_GUARD_SLOTS=<n>` to change the limit, `0` to disable it. CI is never limited.

<!-- kumiko-changes
feature: guards
type: improvement
title: Guard runs queue for a free local slot
detail: At most two full guard runs per machine run at the same time (KUMIKO_GUARD_SLOTS, default 2, 0 disables, unset in CI). Further runs print a waiting line and start when a slot frees up; slots of crashed runs are taken over automatically.
-->
