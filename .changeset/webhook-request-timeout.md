---
"@cosmicdrift/kumiko-bundled-features": patch
---

Webhook requests time out after 10 seconds

A hanging receiver now ends as `step.dispatch-failed` and no longer stalls the step-dispatcher for every tenant.

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: Webhook requests time out after 10 seconds instead of blocking the dispatcher
-->
