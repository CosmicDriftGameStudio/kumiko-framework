---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

The `workflow-run` stream no longer stores a copy of the trigger event's payload. `workflow.run-started` carries `triggerEventRef` (`eventId`, `aggregateId`, `version`) instead of `triggerPayload`, and the wait, waitForEvent and retry step events drop their `triggerPayload` too. `resume-run` re-reads the trigger event from the event store, so erasing or shredding the source event also covers the workflow. A trigger event that can no longer be loaded (for example an archived stream) fails the run with `reason: "trigger_event_unavailable"`.

The `workflow_run_pending` row points at the awaited event through the new `trigger_event_ref` column instead of copying its payload. A matched awaited event that is gone fails the run with `reason: "awaited_event_unavailable"`.

<!-- kumiko-changes
feature: workflow-runner
type: breaking
title: workflow-run stream stores a reference to the trigger event instead of its payload
detail: |
  `workflow.run-started` now holds `triggerEventRef: { eventId, aggregateId, version }` and no `triggerPayload`; the wait, waitForEvent and retry step events no longer embed it either. `workflow_run_pending` gets a `trigger_event_ref` column and the event-subscriber stops writing `trigger_payload`. `resume-run` loads the trigger and the awaited event through `ctx.loadAggregate` and fails the run with `trigger_event_unavailable` or `awaited_event_unavailable` when one is gone.
migration: |
  Own code that reads `triggerPayload` from `workflow.run-started` must read `triggerEventRef` and load the event with `ctx.loadAggregate(ref.aggregateId)`. Apps generate the migration for the new `workflow_run_pending.trigger_event_ref` column with `kumiko schema generate`. The step events `workflow.step.waiting`, `workflow.step.waiting-for-event` and `workflow.retry.scheduled` no longer carry `triggerPayload`; a custom resume loop that read it must load the trigger event through the `triggerEventRef` on its own run-started event (see `samples/recipes/workflow-engine/src/postgres-resume-loop.ts`). Stored run-started events and pending rows keep their old copy; this release rewrites no events, and runs started before it resume from that copy.
-->
