---
"@cosmicdrift/kumiko-framework": minor
---

Add shared /metrics wiring: `prometheusMetricsEnvSchema` and `resolveObservabilityWiring` under `@cosmicdrift/kumiko-framework/observability`

<!-- kumiko-changes
feature: framework
type: improvement
title: Add shared /metrics wiring: prometheusMetricsEnvSchema and resolveObservabilityWiring under @cosmicdrift/kumiko-framework/observability
detail: |
  Apps that expose a Prometheus /metrics endpoint no longer need to hand-roll the fail-closed wiring. Compose prometheusMetricsEnvSchema.shape into your app's env extend block (extend: appSchema.extend(prometheusMetricsEnvSchema.shape)) and spread resolveObservabilityWiring(env.PROMETHEUS_METRICS_TOKEN) into runProdApp. Without a token the endpoint stays off; publicstatus can now drop its local copy of this wiring (publicstatus#479).
-->
