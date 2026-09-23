---
"@cosmicdrift/kumiko-framework": patch
---

Dry-run pulumi/k8s output lists optional env keys as commented-out lines (#3183)

<!-- kumiko-changes
feature: framework
type: fix
title: KUMIKO_DRY_RUN_ENV=pulumi and =k8s now list optional env keys (e.g. PROMETHEUS_METRICS_TOKEN) as commented-out lines under an "Optional" header, with secret flag, generator and description; defaulted keys stay omitted
migration: |
  No action needed. Uncomment and set an optional line only when you want to enable that feature.
-->
