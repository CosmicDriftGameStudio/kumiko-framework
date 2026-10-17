---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Job handlers get ctx.metricsFor like request handlers

<!-- kumiko-changes
feature: framework
type: improvement
title: Job handlers get ctx.metricsFor like request handlers
detail: JobContext now exposes ctx.metricsFor(featureName) with the same contract as HandlerContext, so shared code can count under one stable feature name from jobs too. Unregistered names stay a silent no-op.
-->
