---
"@cosmicdrift/kumiko-server-runtime": minor
---

Worker picks up tenant timezone changes made on API pods

The worker boot now joins the cache sync bus, so a timezone write on an API pod invalidates the worker's cached tenant timezone instead of leaving jobs on the old value until the TTL expires.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Worker picks up tenant timezone changes made on API pods
-->
