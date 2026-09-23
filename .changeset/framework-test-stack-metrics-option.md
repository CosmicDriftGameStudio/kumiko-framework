---
"@cosmicdrift/kumiko-framework": minor
---

setupTestStack accepts a metrics option, forwarded to buildServer like runProdApp (fw#3182)

TestStackOptions gains an optional metrics field forwarded to buildServer. setupTestStackFromFeatures and setupAppTestStack pick it up too since they spread the option through. Spread resolveObservabilityWiring(token) into setupTestStack for the same token-gated /metrics behavior as prod.

<!-- kumiko-changes
feature: framework
type: improvement
title: setupTestStack accepts a metrics option, forwarded to buildServer like runProdApp (fw#3182)
detail: |
  TestStackOptions gains an optional metrics field forwarded to buildServer, same as runProdApp. Spread resolveObservabilityWiring(token) into setupTestStack/setupTestStackFromFeatures/setupAppTestStack to get /metrics mounted in integration tests with the same token-gated PrometheusMeter-backed behavior as prod.
-->
