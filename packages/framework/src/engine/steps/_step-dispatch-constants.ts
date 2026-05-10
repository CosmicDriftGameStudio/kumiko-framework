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
