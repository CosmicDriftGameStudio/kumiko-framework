---
"@cosmicdrift/kumiko-guards": patch
---

The pre-push hook only treats a run as re-entry from `scripts/check-wt.sh` when the owner PID, the owner's command line and a per-run nonce file all match, so `KUMIKO_CHECK_WT_OWNER=$$ git push` no longer skips the pre-flight steps.

<!-- kumiko-changes
feature: guards
type: fix
title: pre-push re-entry needs owner command and nonce, not just an ancestor PID
detail: Any shell could run `KUMIKO_CHECK_WT_OWNER=$$ git push` and the ancestor-PID check passed, switching off `pre-push-extra.sh`, the upgrade-state guard and gitleaks. Before delegating to a tracked `scripts/check-wt.sh` the hook now writes a random nonce to `kumiko-prepush-<pid>` (mode 0600) in the git common dir and passes it as `KUMIKO_CHECK_WT_NONCE`. Re-entry requires the owner to be an ancestor whose command line contains `scripts/check-wt.sh` (or the hook process itself when check-wt.sh exec'd it) and the nonce to match the file. Each outer run removes nonce files whose PID is no longer alive; if the file cannot be written the push is refused.
-->
