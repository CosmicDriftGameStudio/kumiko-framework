// runner — starts a workflow-run by writing run-started, executing the
// pipeline until first suspension or completion, and writing run-completed.
//
// No resume-loop is mounted yet (framework#2480): a suspending step
// (wait / waitForEvent / retry) would leave the run stuck forever with
// nothing to wake it. startAndRunWorkflow surfaces that case as a loud
// WorkflowSuspensionUnsupportedError instead of returning a silent
// "suspended" outcome — callers (registerEventTrigger) treat it like any
// other pipeline failure and record it as a failed run.

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
  readonly triggerPayload: unknown;
  readonly definitionFingerprint: string;
  readonly idempotencyKey?: string;
};

// Canonical run-completed shape — the sample this was hoisted from had two
// writers disagree (`{workflowName}` here, `{stepIndex}` in the not-yet-
// mounted resume-loop). `stepIndex` is the pipeline's top-level step count
// (sub-lists inside branch/forEach aren't counted); every run that reaches
// this event ran to completion in one pass (suspension throws instead of
// returning here).
export type WorkflowRunCompletedPayload = {
  readonly workflowName: string;
  readonly stepIndex: number;
};

export type WorkflowRunFailedPayload = {
  readonly workflowName: string;
  readonly stepIndex: number;
  readonly error: string;
};

export class WorkflowSuspensionUnsupportedError extends Error {
  constructor(
    readonly workflowName: string,
    readonly stepIndex: number,
  ) {
    super(
      `Workflow "${workflowName}" suspended at step ${stepIndex}, but no resume-loop is mounted to wake it (framework#2480) — the run would hang forever. Use only synchronous steps until a resume-loop is mounted.`,
    );
    this.name = "WorkflowSuspensionUnsupportedError";
  }
}

/**
 * Start + execute a workflow run.
 *
 * 1. Append `workflow.run-started` with the Q7 snapshot fingerprint.
 * 2. Run the pipeline. If it suspends, throw — see module doc.
 * 3. On completion, append `workflow.run-completed`. Throws from the
 *    pipeline itself bubble up to the caller (event-trigger), which
 *    records `workflow.run-failed`.
 */
export async function startAndRunWorkflow(args: {
  readonly runId: string;
  readonly workflow: WorkflowDefinition;
  readonly triggerEvent: WriteEvent;
  readonly idempotencyKey?: string;
  readonly handlerCtx: HandlerContext;
}): Promise<{ readonly outcome: "completed" }> {
  const fingerprint = computeDefinitionFingerprint(args.workflow);

  const startedPayload: WorkflowRunStartedPayload = {
    workflowName: args.workflow.name,
    triggerEventType: args.triggerEvent.type,
    triggerPayload: args.triggerEvent.payload,
    definitionFingerprint: fingerprint,
    ...(args.idempotencyKey && { idempotencyKey: args.idempotencyKey }),
  };

  await args.handlerCtx.unsafeAppendEvent({
    aggregateId: args.runId,
    aggregateType: WORKFLOW_AGGREGATE_TYPE,
    type: WORKFLOW_RUN_STARTED_TYPE,
    payload: startedPayload,
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
    throw new WorkflowSuspensionUnsupportedError(args.workflow.name, outcome.stepIndex);
  }

  const completedPayload: WorkflowRunCompletedPayload = {
    workflowName: args.workflow.name,
    stepIndex: steps.length,
  };

  await args.handlerCtx.unsafeAppendEvent({
    aggregateId: args.runId,
    aggregateType: WORKFLOW_AGGREGATE_TYPE,
    type: WORKFLOW_RUN_COMPLETED_TYPE,
    payload: completedPayload,
  });

  return { outcome: "completed" };
}
