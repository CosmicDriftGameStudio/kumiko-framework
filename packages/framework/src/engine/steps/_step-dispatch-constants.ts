// Shared constants for the deferred-step dispatcher pipeline. Extracted
// so individual step-builders (webhook.send, mail.send, ...) don't
// import from each other and silently break on a future split.

export const STEP_DISPATCH_AGGREGATE_TYPE = "step-dispatch";
// System-event namespace (kumiko:system:*) — bypasses registry +
// ownership checks in append-event-core. Reserved for framework-internal
// step-engine coordination. The bundled step-dispatcher MSP listens
// for the literal type-string.
export const STEP_DISPATCH_REQUESTED_TYPE = "kumiko:system:step.dispatch-requested";
export const STEP_DISPATCHED_TYPE = "kumiko:system:step.dispatched";
export const STEP_DISPATCH_FAILED_TYPE = "kumiko:system:step.dispatch-failed";

// --- Tier-3 / Workflow async step constants ---
// Written by wait / waitForEvent / retry steps onto the workflow-run stream.
// The Resume-Loop reads these to decide when to resume a suspended run.
export const WORKFLOW_WAITING_TYPE = "kumiko:system:workflow.step.waiting";
export const WORKFLOW_WAITING_FOR_EVENT_TYPE = "kumiko:system:workflow.step.waiting-for-event";
export const WORKFLOW_RESUMED_TYPE = "kumiko:system:workflow.step.resumed";

// Workflow-run aggregate type — each workflow run is an event-sourced
// aggregate stream.
export const WORKFLOW_AGGREGATE_TYPE = "workflow-run";

// Workflow-run lifecycle events — written by the event-trigger subscriber
// and the resume-loop onto a workflow-run aggregate stream.
export const WORKFLOW_RUN_STARTED_TYPE = "kumiko:system:workflow.run-started";
export const WORKFLOW_RUN_COMPLETED_TYPE = "kumiko:system:workflow.run-completed";
export const WORKFLOW_RUN_FAILED_TYPE = "kumiko:system:workflow.run-failed";

// Step return sentinel — when a step's run() returns this value,
// runStepList stops and yields a "suspended" outcome. The caller
// (defineWorkflow / workflow-engine) persists the suspension state.
export const SUSPEND_SENTINEL = Symbol("kumiko:step:suspend");

// Workflow retry scheduled — written by the retry step when a sub-pipeline
// fails and a retry attempt is scheduled with backoff.
export const WORKFLOW_RETRY_SCHEDULED_TYPE = "kumiko:system:workflow.retry.scheduled";
