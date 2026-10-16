---
"@cosmicdrift/kumiko-guards": minor
---

kumiko-pre-push scans the pushed commits with gitleaks

<!-- kumiko-changes
feature: guards
type: improvement
title: kumiko-pre-push runs a gitleaks scan of origin/main..HEAD before the checks
detail: When the gitleaks binary is installed, the hook runs `gitleaks git --redact --log-opts=origin/main..HEAD` in the repo root and blocks the push on a finding. A `.gitleaks.toml` in the repo root is picked up by gitleaks itself. Without the binary or without origin/main the hook only prints a warning and continues (install with `brew install gitleaks`).
-->
