---
"@cosmicdrift/kumiko-framework": minor
---

drainEventConsumers helper for test stacks with a named consumer backlog

<!-- kumiko-changes
feature: framework
type: improvement
title: drainEventConsumers helper for test stacks with a named consumer backlog
detail: |
  The `while ((await eventDispatcher.runOnce())?.processed ?? 0) > 0) {}`
  pattern under-drains a backlog bigger than one dispatcher batch and gives no
  diagnostics when a consumer is stuck. drainEventConsumers(stack,
  consumerNames, { maxPasses }) from @cosmicdrift/kumiko-framework/stack
  snapshots the events high-water mark at call time and runs bounded passes
  until every named consumer's cursor reaches it, throwing with per-consumer
  status, attempts and lastError when the budget (default 25) is exhausted.
  Events written by consumers after the snapshot are not waited on. No
  migration needed.
-->
