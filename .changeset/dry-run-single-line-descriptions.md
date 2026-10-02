---
"@cosmicdrift/kumiko-framework": patch
---

`KUMIKO_DRY_RUN_ENV` pulumi and k8s output now folds a multi-line `.describe()` text onto one comment line, so the continuation can no longer escape the `#` and run as a shell command or break the YAML stub. The `unprocessable-error-details-reason` codemod now skips a shorthand `reason` whose variable is only used in `details`.

<!-- kumiko-changes
feature: framework
type: fix
title: Dry-run env output keeps multi-line field descriptions inside the comment
-->
