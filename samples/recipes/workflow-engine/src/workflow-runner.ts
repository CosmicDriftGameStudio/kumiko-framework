// workflow-runner — starts a workflow-run by writing run.started and
// executing the pipeline until first suspension or completion.
//
// Q7 (Snapshot-at-Start): the run.started payload carries
// `definitionFingerprint` plus the trigger fields the resume-loop needs
// to re-hydrate state. The fingerprint travels on into every suspension
// event (wait/waitForEvent/retry payloads) so the resume-loop validates
// it without a separate per-run lookup.
//
// On first suspension: just return — the resume-loop wakes the run later.
// On full completion (pipeline ran to r.step.return): we write
// WORKFLOW_RUN_COMPLETED here. Throws bubble up to the caller (event-
// trigger / cron-scheduler) which translates them into RUN_FAILED.

import type {
  HandlerContext,
  WorkflowDefinition,
  WriteEvent,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  buildPipelineSteps,
  computeDefinitionFingerprint,
  runStepList,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";

export type WorkflowRunStartedPayload = {
  readonly workflowName: string;
  readonly triggerEventType: string;
  readonly triggerAggregateId: string;
  readonly triggerPayload: unknown;
  readonly definitionFingerprint: string;
  readonly idempotencyKey?: string;
};

/**
 * Start + execute a workflow run.
 *
 * 1. Append `workflow.run.started` with the snapshot fingerprint.
 * 2. Run the pipeline. Tier-3 steps may suspend it via SUSPEND_SENTINEL.
 * 3. If the pipeline completes without suspension → write
 *    `workflow.run-completed`. If it suspends → leave the resume-loop
 *    to wake it. If it throws → bubble up; the caller writes FAILED.
 */
export async function startAndRunWorkflow(args: {
  readonly runId: string;
  readonly workflow: WorkflowDefinition;
  readonly triggerEvent: WriteEvent;
  readonly idempotencyKey?: string;
  readonly handlerCtx: HandlerContext;
}): Promise<{ readonly outcome: "completed" | "suspended" }> {
  const fingerprint = computeDefinitionFingerprint(args.workflow);

  const startedPayload: WorkflowRunStartedPayload = {
    workflowName: args.workflow.name,
    triggerEventType: args.triggerEvent.type,
    triggerAggregateId: args.triggerEvent.aggregateId,
    triggerPayload: args.triggerEvent.payload,
    definitionFingerprint: fingerprint,
    ...(args.idempotencyKey && { idempotencyKey: args.idempotencyKey }),
  };

  await args.handlerCtx.unsafeAppendEvent({
    aggregateId: args.runId,
    aggregateType: WORKFLOW_AGGREGATE_TYPE,
    type: WORKFLOW_RUN_STARTED_TYPE,
    payload: startedPayload as unknown as Record<string, unknown>,
  });

  const steps = buildPipelineSteps(args.workflow.pipelineDef, args.triggerEvent);

  const outcome = await runStepList(
    steps,
    args.triggerEvent,
    args.handlerCtx,
    {},
    {},
    {
      runId: args.runId,
      workflowName: args.workflow.name,
      stepIndex: 0,
      definitionFingerprint: fingerprint,
    },
  );

  if (outcome.kind === "suspended") {
    return { outcome: "suspended" };
  }

  await args.handlerCtx.unsafeAppendEvent({
    aggregateId: args.runId,
    aggregateType: WORKFLOW_AGGREGATE_TYPE,
    type: WORKFLOW_RUN_COMPLETED_TYPE,
    payload: { workflowName: args.workflow.name },
  });
  return { outcome: "completed" };
}
