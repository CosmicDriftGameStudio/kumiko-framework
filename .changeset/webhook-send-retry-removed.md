---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

`r.step.webhook.send` no longer accepts `retry`

The option was never applied: every dispatch request is delivered once. Passing it is now a type error, and the dispatch-requested payload no longer carries it. Stored events that still contain `retry` are parsed and delivered as before.

<!-- kumiko-changes
feature: step-dispatcher
type: breaking
title: r.step.webhook.send drops the unused retry option
migration: |
  Remove `retry` from `r.step.webhook.send` calls; it was never applied. Each dispatch request is delivered once; a delivery error ends as step.dispatch-failed.
-->
