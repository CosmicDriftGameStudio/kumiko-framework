import { QnTypes, qn } from "@cosmicdrift/kumiko-framework/engine";

export const STEP_DISPATCHER_FEATURE = "step-dispatcher";

export const StepDispatcherJobNames = {
  deliver: "deliver",
  sweepAbandoned: "sweep-abandoned",
} as const;

export const StepDispatcherJobs = {
  deliver: qn(STEP_DISPATCHER_FEATURE, QnTypes.job, StepDispatcherJobNames.deliver),
  sweepAbandoned: qn(STEP_DISPATCHER_FEATURE, QnTypes.job, StepDispatcherJobNames.sweepAbandoned),
} as const;

// Stable per dispatch stream: BullMQ ignores a second add() with the same id,
// so an MSP redelivery cannot enqueue a second delivery.
export function deliverJobId(aggregateId: string): string {
  return `step-dispatch-${aggregateId}`;
}

// Per-tenant cap on simultaneous deliveries, so one tenant's slow receivers
// cannot occupy every worker slot.
export const DELIVER_MAX_PER_TENANT = 2;
export const DELIVER_RETRIES = 3;

// A deliver job spends at most DELIVER_RETRIES exponential retries (1 s base: 1 + 2 + 4 s) plus
// 100 per-tenant defers (maxDefers default, each capped at 30 s + 1 s jitter, about 52 min), so a
// live job is done long before this. Only a stalled or lost job leaves a request older than it
// without an outcome; 24 h also covers a worker lane that was down for a night.
export const ABANDON_DISPATCH_AFTER_HOURS = 24;

// Page size of the daily sweep. The open-stream query filters kumiko_events by aggregate type and
// event type without a matching index (the only index starts with tenant_id), so it is a seq
// scan: the cron runs once a day, not hourly.
export const SWEEP_ABANDONED_BATCH_SIZE = 500;
