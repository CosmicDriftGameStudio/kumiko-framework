---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Boot now rejects three misconfigurations that previously failed silently: a dashboard screen-panel `visibleWhen.field` that is missing from the query's declared `outputSchema`, a job that combines `bootGate` with `runOnBoot` (it ran twice under one job id), and a money field whose `currency` source has an unknown `kind`. `auth-mfa:query:user-mfa:status` now declares its `outputSchema`.

<!-- kumiko-changes
feature: framework
type: fix
title: Boot rejects unknown visibleWhen fields, bootGate with runOnBoot, and unknown money currency kinds
-->
