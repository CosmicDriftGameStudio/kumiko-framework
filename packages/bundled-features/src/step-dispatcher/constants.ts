import { QnTypes, qn } from "@cosmicdrift/kumiko-framework/engine";

export const STEP_DISPATCHER_FEATURE = "step-dispatcher";

export const StepDispatcherJobNames = {
  deliver: "deliver",
} as const;

export const StepDispatcherJobs = {
  deliver: qn(STEP_DISPATCHER_FEATURE, QnTypes.job, StepDispatcherJobNames.deliver),
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
