// resume-loop — polls for suspended workflow runs with expired wake times
// and re-enters the pipeline at the appropriate step.
//
// The Resume-Loop is the runtime that makes Tier-3 steps work:
//   1. Reads the event store for WORKFLOW_WAITING_TYPE events
//   2. Filters on `wakeAt < now()` — runs whose wait period has expired
//   3. Writes a WORKFLOW_RESUMED_TYPE event to the run's stream
//   4. Re-executes the pipeline from the suspended step + 1
//
// For WORKFLOW_RETRY_SCHEDULED_TYPE events:
//   1. Matches step with expired backoff
//   2. Writes a resumed event with retryAttempt = previous + 1
//   3. Re-executes the pipeline at the same step index
//
// The loop is designed to run as a Bun worker / cron job (e.g. every 30s).

import type { HandlerContext, WorkflowDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  buildPipelineSteps,
  computeDefinitionFingerprint,
  runStepList,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { VersionConflictError } from "@cosmicdrift/kumiko-framework/event-store";

export type SuspendableRun = {
  runId: string;
  workflowName: string;
  stepIndex: number;
  wakeAt: string;
  /** Previous retry attempt count — set by the retry step's suspension event. */
  retryAttempt?: number;
  /** The event type that caused the suspension — used by the resume-loop
   *  to decide whether to skip or re-execute the suspended step. */
  suspensionEventType: string;
  /** The workflow the suspension belongs to — resolved by the fetcher from
   *  the registry. The resume-loop validates its current fingerprint
   *  against `definitionFingerprint` below before resuming. */
  workflow: WorkflowDefinition;
  /** The original trigger event payload captured at run.started time
   *  (Q7 Snapshot-at-Start). Re-fed into the pipeline on resume so
   *  resolvers that read `event.payload` see what they saw originally. */
  triggerEvent: unknown;
  /** Fingerprint stamped on the suspension event when the run started.
   *  Resume-loop compares this against the current workflow definition's
   *  fingerprint; a mismatch surfaces as RUN_FAILED with the reason
   *  `workflow-definition-changed`. */
  definitionFingerprint?: string;
};

export class WorkflowDefinitionChangedError extends Error {
  constructor(
    readonly runId: string,
    readonly workflowName: string,
    readonly expectedFingerprint: string,
    readonly currentFingerprint: string,
  ) {
    super(
      `Workflow "${workflowName}" definition changed since run ${runId} started ` +
        `(expected ${expectedFingerprint.slice(0, 12)}…, current ${currentFingerprint.slice(0, 12)}…). ` +
        `Cancel the run or wait for it to complete before deploying definition changes.`,
    );
    this.name = "WorkflowDefinitionChangedError";
  }
}

/**
 * Poll for suspended runs with expired wake times and resume them.
 * Called periodically (e.g. every 30s) by a scheduler or Bun.Timer.
 *
 * @param fetchSuspendedRuns - async function that reads the event store
 *   for WORKFLOW_WAITING_TYPE events where wakeAt < now()
 * @param handlerCtx - the HandlerContext to pass to the pipeline
 * @returns the number of runs resumed
 */
export async function runResumeLoop(
  fetchSuspendedRuns: () => Promise<SuspendableRun[]>,
  handlerCtx: HandlerContext,
): Promise<number> {
  const suspended = await fetchSuspendedRuns();
  let resumed = 0;

  for (const run of suspended) {
    // Q7 fingerprint check FIRST — before we claim the run, before any
    // expensive work, before we burn a stream-version. If the workflow
    // definition changed since the run started, fail loud (do NOT silent-
    // skip — a stale stuck run is worse than an explicit failure).
    if (run.definitionFingerprint !== undefined) {
      const currentFingerprint = computeDefinitionFingerprint(run.workflow);
      if (currentFingerprint !== run.definitionFingerprint) {
        await handlerCtx.unsafeAppendEvent({
          aggregateId: run.runId,
          aggregateType: WORKFLOW_AGGREGATE_TYPE,
          type: WORKFLOW_RUN_FAILED_TYPE,
          payload: {
            workflowName: run.workflowName,
            stepIndex: run.stepIndex,
            error: new WorkflowDefinitionChangedError(
              run.runId,
              run.workflowName,
              run.definitionFingerprint,
              currentFingerprint,
            ).message,
            reason: "workflow-definition-changed",
          },
        });
        continue;
      }
    }

    // Resume-claim: append WORKFLOW_RESUMED first. The event-store appends
    // against expectedVersion = current stream-version; a competing
    // resume-loop instance racing the same run loses the UNIQUE
    // (tenant_id, aggregate_id, version) check and gets a
    // VersionConflictError. That's the concurrency-guard — silent skip,
    // no FAILED-event. Stale WAITING-rows in the fetcher result also
    // hit this branch on the second poll-tick.
    try {
      await handlerCtx.unsafeAppendEvent({
        aggregateId: run.runId,
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        type: WORKFLOW_RESUMED_TYPE,
        payload: {
          stepIndex: run.stepIndex,
          retryAttempt: run.retryAttempt,
        },
      });
    } catch (error) {
      if (error instanceof VersionConflictError) {
        continue;
      }
      throw error;
    }

    try {
      const workflowCtx = {
        runId: run.runId,
        workflowName: run.workflowName,
        stepIndex: run.stepIndex,
        ...(run.retryAttempt ? { retryAttempt: run.retryAttempt + 1 } : {}),
        ...(run.definitionFingerprint && {
          definitionFingerprint: run.definitionFingerprint,
        }),
      };

      // runStepList skip semantics: indices `i < resumeFrom` are skipped,
      // `i >= resumeFrom` execute. Wait/waitForEvent already wrote their
      // suspension event in the original run → resume past them (stepIndex + 1).
      // Retry re-enters at the same index because the retry step itself
      // wraps the sub-pipeline that must run again.
      const resumeFrom =
        run.suspensionEventType === WORKFLOW_RETRY_SCHEDULED_TYPE
          ? run.stepIndex
          : run.stepIndex + 1;

      const steps = buildPipelineSteps(run.workflow.pipelineDef, run.triggerEvent as never);
      const outcome = await runStepList(
        steps,
        run.triggerEvent as never,
        handlerCtx,
        {},
        {},
        workflowCtx,
        resumeFrom,
      );

      // Only write run-completed when the pipeline actually completed or
      // returned. A second suspension (e.g. `wait` further down the
      // pipeline) leaves the run pending for the next resume-loop tick.
      if (outcome.kind !== "suspended") {
        await handlerCtx.unsafeAppendEvent({
          aggregateId: run.runId,
          aggregateType: WORKFLOW_AGGREGATE_TYPE,
          type: WORKFLOW_RUN_COMPLETED_TYPE,
          payload: { stepIndex: run.stepIndex },
        });
      }

      resumed++;
    } catch (error) {
      await handlerCtx.unsafeAppendEvent({
        aggregateId: run.runId,
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        type: WORKFLOW_RUN_FAILED_TYPE,
        payload: {
          stepIndex: run.stepIndex,
          error: String(error),
        },
      });
    }
  }

  return resumed;
}
