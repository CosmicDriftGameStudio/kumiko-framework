// runner — starts a workflow-run by writing run-started, executing the
// pipeline until first suspension or completion, and writing run-completed.
//
// wait / retry / waitForEvent suspensions are all resumable — the
// resume-due-runs job + resume-run handler (framework#2513 Phase 2) wake
// wait/retry via a plain wakeAt timeout; waitForEvent additionally gets
// woken early by the event-subscriber (Phase 3b, event-subscriber.ts) when
// its awaited event arrives, and by the same wakeAt timeout otherwise
// (D1's `wakeAt ?? timeoutAt`). startAndRunWorkflow returns a silent
// "suspended" outcome for all three instead of throwing.

import type {
  HandlerContext,
  StepInstance,
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

// Suspensions the resume loop knows how to wake — every Tier-3 step that
// can return SUSPEND_SENTINEL. Kept as an explicit allowlist (not "every
// registered Tier-3 step") so a future suspending step that forgets to
// wire up its own wake path fails loud via WorkflowSuspensionUnsupportedError
// instead of hanging a run forever.
const RESUMABLE_STEP_KINDS = new Set(["workflow.wait", "workflow.retry", "workflow.waitForEvent"]);

export function isResumableSuspension(steps: readonly StepInstance[], stepIndex: number): boolean {
  return RESUMABLE_STEP_KINDS.has(steps[stepIndex]?.kind ?? "");
}

export type WorkflowRunStartedPayload = {
  readonly workflowName: string;
  readonly triggerEventType: string;
  readonly triggerPayload: unknown;
  readonly definitionFingerprint: string;
  readonly idempotencyKey?: string;
};

// Canonical run-completed shape — the sample this was hoisted from had two
// writers disagree (`{workflowName}` here, `{stepIndex}` in the resume-loop
// sample). `stepIndex` is the pipeline's top-level step count (sub-lists
// inside branch/forEach aren't counted). A run reaches this event either in
// one pass, or across multiple passes when a wait/retry suspension resumed
// it (resume-run writes this same event on the pass that finally completes).
export type WorkflowRunCompletedPayload = {
  readonly workflowName: string;
  readonly stepIndex: number;
};

export type WorkflowRunFailedPayload = {
  readonly workflowName: string;
  readonly stepIndex: number;
  readonly error: string;
  // Machine-readable failure category — set by resume-run for a Q7
  // fingerprint mismatch ("workflow_definition_changed"); absent for a
  // plain pipeline-step failure (the `error` string is human-readable only).
  readonly reason?: string;
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
}): Promise<{ readonly outcome: "completed" | "suspended" }> {
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
    if (!isResumableSuspension(steps, outcome.stepIndex)) {
      throw new WorkflowSuspensionUnsupportedError(args.workflow.name, outcome.stepIndex);
    }
    // pending-projection.ts already materialised the row that
    // resume-due-runs will pick up (or the event-subscriber will wake
    // early, for waitForEvent) — nothing more to do on this pass.
    return { outcome: "suspended" };
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
