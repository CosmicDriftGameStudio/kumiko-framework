---
"@cosmicdrift/kumiko-bundled-features": minor
---

New bundled feature `workflow-runner`: writes the run-envelope for a workflow run (`workflow.run-started` / `workflow.run-completed` / `workflow.run-failed`) onto its `workflow-run` aggregate stream. Until now nothing in the framework wrote these events — the run lifecycle existed only as an unmounted sample, so consumers hand-rolled a run context and had no events to build run observability on.

Mount `workflowRunnerFeature`, then wire a `defineWorkflow` definition to a domain event from your own feature:

```ts
import { registerEventTrigger } from "@cosmicdrift/kumiko-bundled-features/workflow-runner";

defineFeature("my-feature", (r) => {
  registerEventTrigger(r, myWorkflow);
});
```

`startAndRunWorkflow` is exported for callers that start a run directly. The payload types (`WorkflowRunStartedPayload`, `WorkflowRunCompletedPayload`, `WorkflowRunFailedPayload`) are exported so a projection can read the events type-safely.

Three things to know when consuming these events:

- `workflowName` is not recoverable from the `aggregateId` — it is a UUIDv5 derived from `(workflowName, idempotencyKey)`. Read `payload.workflowName` instead.
- A shared idempotency key does not deduplicate sequential re-triggers. It only makes *concurrent* triggers for that key race on the aggregate's unique constraint; sequential ones each start their own run on the same stream.
- No resume-loop is bundled yet. A workflow that hits a suspending step (`wait` / `waitForEvent` / `retry`) fails loudly with `WorkflowSuspensionUnsupportedError` and is recorded as `run-started → run-failed`, rather than hanging forever with nothing to wake it.
