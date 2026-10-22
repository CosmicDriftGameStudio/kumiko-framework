---
"@cosmicdrift/kumiko-guards": patch
---

The pre-push hook recognises its wrapping `scripts/check-wt.sh` by process ancestry instead of the freely settable `KUMIKO_CHECK_WT=1`. Exporting that variable on a normal push no longer skips a tracked `check-wt.sh`, so it cannot quietly reduce the check to the `package.json` scripts. Existing `check-wt.sh` files that still set `KUMIKO_CHECK_WT=1` keep working unchanged.

<!-- kumiko-changes
feature: guards
type: fix
title: pre-push re-entry detection no longer an env switch
detail: Before delegating to a tracked scripts/check-wt.sh the hook records its own PID in KUMIKO_CHECK_WT_OWNER and treats a run as re-entry only when that PID is an ancestor of the current process, whether check-wt.sh execs or spawns the hook. KUMIKO_CHECK_WT=1 is ignored, so it cannot skip check-wt.sh; wrappers that still set it need no change.
-->
