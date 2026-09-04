// resume-run — wakes one suspended workflow step. Dispatched by the
// resume-due-runs job (framework#2513 Phase 2), never called directly by a
// user — r.systemScope() + access: { roles: [SYSTEM_ROLE] } enforce that.
//
// The job does nothing but SELECT + dispatch; all resume logic lives here,
// adapted from samples/recipes/workflow-engine/src/resume-loop.ts:
//   1. Q7 fingerprint check FIRST — before claiming, before any pipeline
//      work. A changed workflow definition fails loud (WORKFLOW_RUN_FAILED,
//      reason "workflow_definition_changed"), never a silent skip.
//   2. Claim via a savepoint-scoped WORKFLOW_RESUMED append (ctx.tryAppendEvent,
//      not unsafeAppendEvent — a losing VersionConflict must not poison this
//      handler's own transaction). A losing claim means another worker beat
//      us to this row; silent no-op.
//   3. Re-run the pipeline via runStepList with resumeFrom: the suspended
//      step's own index for a retry (re-enters the step), stepIndex + 1
//      otherwise (wait already wrote its effect; resume past it).
//
// The run's ORIGINAL trigger event (the one that started the whole run) is
// always recovered from the run's own WORKFLOW_RUN_STARTED_TYPE event,
// never from the pending row — that event always carries it (see
// WorkflowRunStartedPayload in ./runner). The pending row's own
// triggerEventType/triggerPayload columns are a DIFFERENT thing: for a
// waitForEvent suspension they hold the AWAITED event the Phase 3b
// event-subscriber matched (NULL until then, and NULL forever on a
// timeout-without-a-match). That payload becomes the resumed pipeline's
// result for the skipped waitForEvent step itself (see resultKey on
// steps/wait-for-event.ts) — pre-seeded into stepsAcc below so a
// subsequent step's resolver can read `ctx.steps[awaits.someKey]`.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildPipelineSteps,
  computeDefinitionFingerprint,
  getStep,
  type HandlerContext,
  runStepList,
  type StepInstance,
  SYSTEM_ROLE,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  type WorkflowDefinition,
  type WriteEvent,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import {
  isResumableSuspension,
  type WorkflowRunCompletedPayload,
  type WorkflowRunFailedPayload,
  type WorkflowRunStartedPayload,
  WorkflowSuspensionUnsupportedError,
} from "../runner";
import { workflowRunPendingTable } from "../tables";
import { getWorkflow } from "../workflow-registry";

const resumeRunSchema = z.object({
  runId: z.string().min(1),
  stepIndex: z.number().int().nonnegative(),
});

async function appendRunFailed(
  ctx: HandlerContext,
  runId: string,
  failedPayload: WorkflowRunFailedPayload,
): Promise<void> {
  await ctx.unsafeAppendEvent({
    aggregateId: runId,
    aggregateType: WORKFLOW_AGGREGATE_TYPE,
    type: WORKFLOW_RUN_FAILED_TYPE,
    payload: failedPayload,
  });
}

function checkQ7Fingerprint(
  workflow: WorkflowDefinition,
  workflowName: string,
  runId: string,
  stepIndex: number,
  storedFingerprint: string | null,
): WorkflowRunFailedPayload | null {
  const currentFingerprint = computeDefinitionFingerprint(workflow);
  const fingerprintChanged = storedFingerprint !== null && currentFingerprint !== storedFingerprint;
  if (!fingerprintChanged) {
    return null;
  }
  return {
    workflowName,
    stepIndex,
    error:
      `Workflow "${workflowName}" definition changed since run ${runId} started ` +
      `(expected ${storedFingerprint?.slice(0, 12)}…, current ${currentFingerprint?.slice(0, 12)}…).`,
    reason: "workflow_definition_changed",
  };
}

async function recoverTriggerEvent(
  ctx: HandlerContext,
  runId: string,
  workflowName: string,
  user: WriteEvent["user"],
): Promise<WriteEvent> {
  const startedEvents = await ctx.loadAggregate(runId);
  const started = startedEvents.find((e) => e.type === WORKFLOW_RUN_STARTED_TYPE);
  if (!started) {
    throw new InternalError({
      message: `workflow-runner:write:resume-run: run ${runId} has no ${WORKFLOW_RUN_STARTED_TYPE} event — cannot recover its trigger event.`,
    });
  }
  const startedPayload = started.payload as WorkflowRunStartedPayload; // @cast-boundary event-store-payload
  const triggerEvent: WriteEvent = {
    type: startedPayload.triggerEventType,
    payload: startedPayload.triggerPayload,
    user,
  };
  return triggerEvent;
}

// The suspended waitForEvent step itself is skipped on resume
// (resumeFrom = stepIndex + 1) — its run() never re-executes, so its
// resultKey (args.event, see steps/wait-for-event.ts) never gets
// populated by the normal runStepList loop. Seed it here from the
// pending row's own triggerPayload so a subsequent step's resolver
// sees the matched event via `ctx.steps[awaits.someKey]`, same as any
// other step result. NULL on a timeout-without-a-match — a later
// resolver reading it just sees `undefined`, no special-casing needed.
function seedResumedStepResults(
  pending: { suspensionEventType: string; triggerPayload: unknown | null },
  steps: readonly StepInstance[],
  stepIndex: number,
): Record<string, unknown> {
  const stepsAcc: Record<string, unknown> = {};
  if (pending.suspensionEventType === WORKFLOW_WAITING_FOR_EVENT_TYPE) {
    const suspendedStep = steps[stepIndex];
    const key = suspendedStep && getStep(suspendedStep.kind)?.resultKey?.(suspendedStep.args);
    if (key !== undefined) {
      stepsAcc[key] = pending.triggerPayload;
    }
  }
  return stepsAcc;
}

export const resumeRunHandler: WriteHandlerDef = {
  name: "resume-run",
  schema: resumeRunSchema,
  access: { roles: [SYSTEM_ROLE] },
  handler: async (event, ctx) => {
    const { runId, stepIndex } = event.payload as z.infer<typeof resumeRunSchema>;
    const tenantId = event.user.tenantId;

    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "workflow-runner:write:resume-run requires ctx.systemDb — is r.systemScope() still set on the workflow-runner feature?",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(tenantId);

    const pending = await fetchOne<{
      workflowName: string;
      suspensionEventType: string;
      retryAttempt: number | null;
      definitionFingerprint: string | null;
      triggerPayload: unknown | null;
    }>(db, workflowRunPendingTable, { runId, stepIndex, tenantId });

    if (!pending) {
      // skip: no pending row for (runId, stepIndex, tenantId) — another
      // worker already resumed it (or the run reached a terminal state)
      // between the job's SELECT and this dispatch; pending-projection.ts
      // already deleted it.
      return { isSuccess: true, data: { outcome: "already-resumed" as const } };
    }

    const { workflowName } = pending;
    const workflow = getWorkflow(workflowName);
    if (!workflow) {
      const failedPayload: WorkflowRunFailedPayload = {
        workflowName,
        stepIndex,
        error: `Workflow "${workflowName}" is not registered — cannot resume run ${runId}.`,
        reason: "workflow_definition_changed",
      };
      await appendRunFailed(ctx, runId, failedPayload);
      return { isSuccess: true, data: { outcome: "failed" as const } };
    }

    const fingerprintFailure = checkQ7Fingerprint(
      workflow,
      workflowName,
      runId,
      stepIndex,
      pending.definitionFingerprint,
    );
    if (fingerprintFailure) {
      await appendRunFailed(ctx, runId, fingerprintFailure);
      return { isSuccess: true, data: { outcome: "failed" as const } };
    }

    const claim = await ctx.tryAppendEvent({
      aggregateId: runId,
      aggregateType: WORKFLOW_AGGREGATE_TYPE,
      type: WORKFLOW_RESUMED_TYPE,
      payload: {
        stepIndex,
        retryAttempt: pending.retryAttempt ?? undefined,
      },
    });
    if (!claim.ok) {
      // skip: lost the claim race against a concurrent resume-run dispatch
      // for the same (runId, stepIndex) — the winner already re-runs the
      // pipeline; nothing left for this call to do.
      return { isSuccess: true, data: { outcome: "already-resumed" as const } };
    }

    const triggerEvent = await recoverTriggerEvent(ctx, runId, workflowName, event.user);

    const resumeFrom =
      pending.suspensionEventType === WORKFLOW_RETRY_SCHEDULED_TYPE ? stepIndex : stepIndex + 1;

    try {
      const steps = buildPipelineSteps(workflow.pipelineDef, triggerEvent);
      const workflowCtx = {
        runId,
        workflowName,
        stepIndex,
        definitionFingerprint: pending.definitionFingerprint ?? undefined,
        ...(pending.retryAttempt !== null && { retryAttempt: pending.retryAttempt + 1 }),
      };

      const stepsAcc = seedResumedStepResults(pending, steps, stepIndex);

      const outcome = await runStepList(
        steps,
        triggerEvent,
        ctx,
        stepsAcc,
        {},
        workflowCtx,
        resumeFrom,
      );

      if (outcome.kind === "suspended") {
        if (!isResumableSuspension(steps, outcome.stepIndex)) {
          throw new WorkflowSuspensionUnsupportedError(workflowName, outcome.stepIndex);
        }
        // Another suspension further down the pipeline — pending-projection.ts
        // already materialised the new row; nothing more to do this pass.
        return { isSuccess: true, data: { outcome: "suspended" as const } };
      }

      const completedPayload: WorkflowRunCompletedPayload = {
        workflowName,
        stepIndex: steps.length,
      };
      await ctx.unsafeAppendEvent({
        aggregateId: runId,
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        type: WORKFLOW_RUN_COMPLETED_TYPE,
        payload: completedPayload,
      });
      return { isSuccess: true, data: { outcome: "completed" as const } };
    } catch (error) {
      const failedPayload: WorkflowRunFailedPayload = {
        workflowName,
        stepIndex,
        error: String(error),
      };
      await appendRunFailed(ctx, runId, failedPayload);
      return { isSuccess: true, data: { outcome: "failed" as const } };
    }
  },
};
