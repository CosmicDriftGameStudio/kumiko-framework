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
// always re-read from the event store via the triggerEventRef on the run's
// own WORKFLOW_RUN_STARTED_TYPE event, never from the pending row (see
// WorkflowRunStartedPayload in ./runner). Neither the run stream nor the
// pending row holds a copy of a foreign payload, so an erased source event
// shows up here in its shredded form, and an unloadable one (archived
// stream) fails the run. The pending row's own
// triggerEventType/triggerEventRef columns are a DIFFERENT thing: for a
// waitForEvent suspension they point at the AWAITED event the Phase 3b
// event-subscriber matched (NULL until then, and NULL forever on a
// timeout-without-a-match). That event's payload becomes the resumed
// pipeline's result for the skipped waitForEvent step itself (see
// resultKey on steps/wait-for-event.ts) — pre-seeded into stepsAcc below so
// a subsequent step's resolver can read `ctx.steps[awaits.someKey]`.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildPipelineSteps,
  computeDefinitionFingerprint,
  describeWorkflowStepError,
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
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import * as z from "zod";
import {
  isResumableSuspension,
  type TriggerEventRef,
  type WorkflowRunCompletedPayload,
  type WorkflowRunFailedPayload,
  WorkflowSuspensionUnsupportedError,
} from "../runner.js";
import { workflowRunPendingTable } from "../tables.js";
import { getWorkflow } from "../workflow-registry.js";

const log = createFallbackLogger("workflow-runner");

const resumeRunSchema = z.object({
  runId: z.string().uuid(),
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

type ResolvedWorkflow =
  | { readonly workflow: WorkflowDefinition; readonly failure: null }
  | { readonly workflow: null; readonly failure: WorkflowRunFailedPayload };

// Both preconditions fail the run the same way, so they resolve together: the
// workflow must still be registered AND its definition must still match the
// fingerprint the run was started against.
function resolveRunnableWorkflow(
  workflowName: string,
  runId: string,
  stepIndex: number,
  storedFingerprint: string | null,
): ResolvedWorkflow {
  const workflow = getWorkflow(workflowName);
  if (!workflow) {
    return {
      workflow: null,
      failure: {
        workflowName,
        stepIndex,
        error: `Workflow "${workflowName}" is not registered — cannot resume run ${runId}.`,
        reason: "workflow_definition_changed",
      },
    };
  }
  const fingerprintFailure = checkQ7Fingerprint(
    workflow,
    workflowName,
    runId,
    stepIndex,
    storedFingerprint,
  );
  return fingerprintFailure
    ? { workflow: null, failure: fingerprintFailure }
    : { workflow, failure: null };
}

function readResumedPayload(payload: unknown): {
  readonly stepIndex: number | undefined;
  readonly retryAttempt: number | undefined;
} {
  if (typeof payload !== "object" || payload === null) {
    return { stepIndex: undefined, retryAttempt: undefined };
  }
  const stepIndex =
    "stepIndex" in payload && typeof payload.stepIndex === "number" ? payload.stepIndex : undefined;
  const retryAttempt =
    "retryAttempt" in payload && typeof payload.retryAttempt === "number"
      ? payload.retryAttempt
      : undefined;
  return { stepIndex, retryAttempt };
}

// The workflow_run_pending row is only deleted asynchronously by
// pending-projection, so a resume-due-runs tick inside that window finds the
// row again and the append-claim no longer conflicts — the event stream is the
// authoritative idempotency source.
//
// retryAttempt must match too, not just stepIndex: a retry suspension resumes
// the SAME stepIndex on every attempt, so matching on stepIndex alone would
// mistake attempt 1's WORKFLOW_RESUMED for attempt 2's and skip the second
// retry entirely.
function isRunAlreadySettled(
  runEvents: Awaited<ReturnType<HandlerContext["loadAggregate"]>>,
  stepIndex: number,
  expectedRetryAttempt: number | undefined,
): boolean {
  return runEvents.some((e) => {
    if (e.type === WORKFLOW_RUN_COMPLETED_TYPE || e.type === WORKFLOW_RUN_FAILED_TYPE) {
      return true;
    }
    if (e.type !== WORKFLOW_RESUMED_TYPE) {
      return false;
    }
    const resumed = readResumedPayload(e.payload);
    return resumed.stepIndex === stepIndex && resumed.retryAttempt === expectedRetryAttempt;
  });
}

type LoadedEvents = Awaited<ReturnType<HandlerContext["loadAggregate"]>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTriggerEventRef(value: unknown): value is TriggerEventRef {
  return (
    isRecord(value) &&
    typeof value["eventId"] === "string" &&
    typeof value["aggregateId"] === "string" &&
    typeof value["version"] === "number"
  );
}

// run-started events written before the reference existed carry a copy of the
// trigger payload instead; they stay readable for runs still in flight.
type TriggerSource =
  | { readonly kind: "ref"; readonly eventType: string; readonly ref: TriggerEventRef }
  | { readonly kind: "legacy-copy"; readonly eventType: string; readonly payload: unknown };

function readTriggerSource(startedPayload: unknown): TriggerSource | null {
  if (!isRecord(startedPayload) || typeof startedPayload["triggerEventType"] !== "string") {
    return null;
  }
  const eventType = startedPayload["triggerEventType"];
  const ref = startedPayload["triggerEventRef"];
  if (isTriggerEventRef(ref)) {
    return { kind: "ref", eventType, ref };
  }
  if ("triggerPayload" in startedPayload) {
    return { kind: "legacy-copy", eventType, payload: startedPayload["triggerPayload"] };
  }
  return null;
}

async function loadReferencedEvent(ctx: HandlerContext, ref: TriggerEventRef) {
  const events = await ctx.loadAggregate(ref.aggregateId);
  return events.find((e) => e.id === ref.eventId);
}

type RecoveredTrigger =
  | { readonly event: WriteEvent; readonly unavailable: false }
  | { readonly event: null; readonly unavailable: true };

async function recoverTriggerEvent(
  ctx: HandlerContext,
  runEvents: LoadedEvents,
  runId: string,
  user: WriteEvent["user"],
): Promise<RecoveredTrigger> {
  const started = runEvents.find((e) => e.type === WORKFLOW_RUN_STARTED_TYPE);
  if (!started) {
    throw new InternalError({
      message: `workflow-runner:write:resume-run: run ${runId} has no ${WORKFLOW_RUN_STARTED_TYPE} event — cannot recover its trigger event.`,
    });
  }
  const source = readTriggerSource(started.payload);
  if (!source) {
    throw new InternalError({
      message: `workflow-runner:write:resume-run: run ${runId} has a malformed ${WORKFLOW_RUN_STARTED_TYPE} event — neither triggerEventRef nor a legacy triggerPayload.`,
    });
  }
  if (source.kind === "legacy-copy") {
    return {
      event: { type: source.eventType, payload: source.payload, user },
      unavailable: false,
    };
  }
  const triggerEvent = await loadReferencedEvent(ctx, source.ref);
  if (!triggerEvent) {
    return { event: null, unavailable: true };
  }
  return {
    event: { type: source.eventType, payload: triggerEvent.payload, user },
    unavailable: false,
  };
}

type PendingTriggerColumns = {
  readonly triggerEventRef: unknown | null;
  readonly triggerPayload: unknown | null;
};

type AwaitedPayload =
  | { readonly unavailable: false; readonly payload: unknown }
  | { readonly unavailable: true };

// NULL ref + NULL payload = timeout without a match: the step result stays
// undefined, same as before. A matched row whose event can no longer be loaded
// is NOT folded into that case: a later step could not tell "nothing arrived"
// from "arrived but gone" and would run on missing data, so the run fails
// instead. Rows matched before the reference existed still carry the copy.
async function loadAwaitedPayload(
  ctx: HandlerContext,
  pending: PendingTriggerColumns,
): Promise<AwaitedPayload> {
  if (!isTriggerEventRef(pending.triggerEventRef)) {
    return { unavailable: false, payload: pending.triggerPayload ?? undefined };
  }
  const awaited = await loadReferencedEvent(ctx, pending.triggerEventRef);
  return awaited ? { unavailable: false, payload: awaited.payload } : { unavailable: true };
}

// The suspended waitForEvent step itself is skipped on resume
// (resumeFrom = stepIndex + 1) — its run() never re-executes, so its
// resultKey (args.event, see steps/wait-for-event.ts) never gets
// populated by the normal runStepList loop. Seed it here from the awaited
// event's payload so a subsequent step's resolver sees the matched event via
// `ctx.steps[awaits.someKey]`, same as any other step result.
function seedResumedStepResults(
  suspensionEventType: string,
  awaitedPayload: unknown,
  steps: readonly StepInstance[],
  stepIndex: number,
): Record<string, unknown> {
  const stepsAcc: Record<string, unknown> = {};
  if (suspensionEventType === WORKFLOW_WAITING_FOR_EVENT_TYPE) {
    const suspendedStep = steps[stepIndex];
    const key = suspendedStep && getStep(suspendedStep.kind)?.resultKey?.(suspendedStep.args);
    if (key !== undefined) {
      stepsAcc[key] = awaitedPayload;
    }
  }
  return stepsAcc;
}

type ResumedPipelineInput = {
  readonly workflow: WorkflowDefinition;
  readonly workflowName: string;
  readonly runId: string;
  readonly stepIndex: number;
  readonly resumeFrom: number;
  readonly triggerEvent: WriteEvent;
  readonly awaitedPayload: unknown;
  readonly pending: {
    readonly suspensionEventType: string;
    readonly retryAttempt: number | null;
    readonly definitionFingerprint: string | null;
  };
};

async function runResumedPipeline(ctx: HandlerContext, input: ResumedPipelineInput) {
  const {
    workflow,
    workflowName,
    runId,
    stepIndex,
    resumeFrom,
    triggerEvent,
    awaitedPayload,
    pending,
  } = input;
  try {
    const steps = buildPipelineSteps(workflow.pipelineDef, triggerEvent);
    const workflowCtx = {
      runId,
      workflowName,
      stepIndex,
      definitionFingerprint: pending.definitionFingerprint ?? undefined,
      ...(pending.retryAttempt !== null && { retryAttempt: pending.retryAttempt + 1 }),
    };

    const stepsAcc = seedResumedStepResults(
      pending.suspensionEventType,
      awaitedPayload,
      steps,
      stepIndex,
    );

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
      return { isSuccess: true as const, data: { outcome: "suspended" as const } };
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
    return { isSuccess: true as const, data: { outcome: "completed" as const } };
  } catch (error) {
    log.warn("workflow run failed", { runId, workflowName, stepIndex, error: String(error) });
    const failedPayload: WorkflowRunFailedPayload = {
      workflowName,
      stepIndex,
      error: describeWorkflowStepError(error),
    };
    await appendRunFailed(ctx, runId, failedPayload);
    return { isSuccess: true as const, data: { outcome: "failed" as const } };
  }
}

export const resumeRunHandler: WriteHandlerDef = {
  name: "resume-run",
  agent: { expose: false },
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
      triggerEventRef: unknown | null;
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
    const runEvents = await ctx.loadAggregate(runId);

    // Before the workflow resolution: a racing tick on an already-settled run
    // must not append run-failed after run-completed when the definition has
    // since changed or been removed.
    if (isRunAlreadySettled(runEvents, stepIndex, pending.retryAttempt ?? undefined)) {
      return { isSuccess: true, data: { outcome: "already-resumed" as const } };
    }

    const resolved = resolveRunnableWorkflow(
      workflowName,
      runId,
      stepIndex,
      pending.definitionFingerprint,
    );
    if (resolved.failure !== null) {
      await appendRunFailed(ctx, runId, resolved.failure);
      return { isSuccess: true, data: { outcome: "failed" as const } };
    }
    const workflow = resolved.workflow;

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

    const recovered = await recoverTriggerEvent(ctx, runEvents, runId, event.user);
    if (recovered.unavailable) {
      await appendRunFailed(ctx, runId, {
        workflowName,
        stepIndex,
        error: `Trigger event of run ${runId} is no longer available — cannot resume.`,
        reason: "trigger_event_unavailable",
      });
      return { isSuccess: true, data: { outcome: "failed" as const } };
    }
    const triggerEvent = recovered.event;

    const awaited =
      pending.suspensionEventType === WORKFLOW_WAITING_FOR_EVENT_TYPE
        ? await loadAwaitedPayload(ctx, pending)
        : ({ unavailable: false, payload: undefined } as const);
    if (awaited.unavailable) {
      await appendRunFailed(ctx, runId, {
        workflowName,
        stepIndex,
        error: `Awaited event of run ${runId} is no longer available — cannot resume.`,
        reason: "awaited_event_unavailable",
      });
      return { isSuccess: true, data: { outcome: "failed" as const } };
    }

    const resumeFrom =
      pending.suspensionEventType === WORKFLOW_RETRY_SCHEDULED_TYPE ? stepIndex : stepIndex + 1;

    return runResumedPipeline(ctx, {
      workflow,
      workflowName,
      runId,
      stepIndex,
      resumeFrom,
      triggerEvent,
      awaitedPayload: awaited.payload,
      pending,
    });
  },
};
