---
"@cosmicdrift/kumiko-guards": patch
---

The Real-Provider-Isolation guard allows `test:real`, `e2e:real` and `KUMIKO_REAL_PROVIDERS` in CI workflows whose `on:` triggers are exclusively `schedule` and/or `workflow_dispatch`, so an app can run its real-provider suite weekly or by hand. Any other trigger next to them (`push`, `pull_request`, `pull_request_target`, `workflow_call`, ...) or a workflow without a parseable `on:` is still a violation.

<!-- kumiko-changes
feature: guards
type: improvement
title: Real-Provider-Isolation guard allows real runs in schedule- or workflow_dispatch-only workflows
-->
