// event-trigger — MultiStreamProjection that listens for domain events and
// starts + runs a workflow when the event matches its trigger.
//
// Registration pattern:
//   registerEventTrigger(r, myWorkflow)
//
// The apply-fn does NOT run in the dispatcher's cursor tx (the server's MSP
// wiring uses the unbound pool), so `workflow.run-started` and the rest of
// the pipeline are not atomic. A throw from startAndRunWorkflow is recorded
// as `workflow.run-failed` and swallowed, so the dispatcher moves on.

import type {
  FeatureRegistrar,
  MultiStreamProjectionDefinition,
  StepInstance,
  WorkflowDefinition,
  WriteEvent,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  buildPipelineSteps,
  createSystemUser,
  describeWorkflowStepError,
  getStep,
  SYSTEM_TENANT_ID,
  type TenantId,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WorkflowStepError,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { workflowRunAggregateId } from "./aggregate-id.js";
import { registerEventWakeup } from "./event-subscriber.js";
import {
  startAndRunWorkflow,
  type WorkflowRunFailedPayload,
  WorkflowSuspensionUnsupportedError,
} from "./runner.js";
import { registerWorkflow } from "./workflow-registry.js";

const log = createFallbackLogger("workflow-runner");

// The MSP apply context only offers unsafeAppendEvent/loadAggregate; these steps reach for
// ctx.db/write/writeAs and would crash on the first run instead of at registration.
const STEP_KINDS_NEEDING_HANDLER_CONTEXT: ReadonlySet<string> = new Set([
  "aggregate.create",
  "aggregate.update",
  "callFeature",
  "read.findOne",
  "read.findMany",
  "unsafeProjectionUpsert",
  "unsafeProjectionDelete",
]);

function* walkStepInstances(steps: readonly StepInstance[]): Generator<StepInstance, void, void> {
  for (const step of steps) {
    yield step;
    const { args } = step;
    if (typeof args !== "object" || args === null) continue;
    for (const path of getStep(step.kind)?.subPaths ?? []) {
      const nested: unknown = path in args ? Reflect.get(args, path) : undefined;
      if (Array.isArray(nested)) yield* walkStepInstances(nested);
    }
  }
}

export function assertEventTriggerStepsSupported(workflow: WorkflowDefinition): void {
  let steps: readonly StepInstance[];
  try {
    // Same contract as the boot validator for handler pipelines: the closure must build its
    // step list from the step builder alone, so an empty event is enough to enumerate kinds.
    steps = buildPipelineSteps(workflow.pipelineDef, {
      type: "workflow-registration-probe",
      payload: {},
      user: createSystemUser(SYSTEM_TENANT_ID as TenantId),
    });
  } catch (error) {
    throw new Error(
      `Workflow "${workflow.name}" pipeline closure threw at registration: ${String(error)}. ` +
        "Build the step list without reading event payload fields; read them inside step resolvers.",
      { cause: error },
    );
  }
  for (const step of walkStepInstances(steps)) {
    if (getStep(step.kind) === undefined) {
      throw new Error(`Workflow "${workflow.name}" uses unknown step kind "${step.kind}"`);
    }
    if (STEP_KINDS_NEEDING_HANDLER_CONTEXT.has(step.kind)) {
      throw new Error(
        `Workflow "${workflow.name}" is event-triggered but uses step "${step.kind}", which needs a ` +
          "handler context (db/write) the event-trigger projection does not provide.",
      );
    }
  }
}

export function registerEventTrigger(r: FeatureRegistrar, workflow: WorkflowDefinition): void {
  // Populate the workflow-registry unconditionally, before the event-trigger
  // guard below — resume-run (framework#2513 Phase 2) looks workflows up by
  // name regardless of trigger kind, and a cron-triggered workflow that never
  // reaches the MSP branch still needs to be resumable.
  registerWorkflow(workflow);

  // Independent of trigger.kind — a cron-triggered workflow can still have
  // waitForEvent steps in its pipeline (framework#2513 Phase 3b, D4).
  registerEventWakeup(r, workflow);

  // skip: cron-triggered workflows have no domain event to project off — they
  // need a scheduler, not an MSP, so there is nothing to register here.
  if (workflow.trigger.kind !== "event") return;

  assertEventTriggerStepsSupported(workflow);

  const eventType = workflow.trigger.eventType;

  r.multiStreamProjection({
    name: `workflow-${workflow.name}`,
    // Mounting an event-triggered workflow into an existing app must not
    // replay the historical log and fire every side-effect step retroactively.
    startFrom: "now",
    apply: {
      [eventType]: async (event, _tx, ctx) => {
        // skip: unreachable — the guard above already established this, but the
        // closure does not carry that narrowing, and re-narrowing here keeps
        // `trigger.filter` below typed without a cast.
        if (workflow.trigger.kind !== "event") return;

        // @cast-boundary msp-to-write-event — the MSP delivers a StoredEvent
        // (event-store shape); the workflow runner expects a WriteEvent
        // (handler shape). The fields workflow steps read (type, payload)
        // overlap exactly — the missing `.user` field is acceptable because
        // workflow triggers run system-level, not user-scoped.
        const triggerEvent = event as unknown as WriteEvent;
        // skip: the workflow's own trigger filter rejected this event — not this run's
        // concern, so no run is started and nothing is recorded.
        if (workflow.trigger.filter && !workflow.trigger.filter(triggerEvent)) return;
        let idempotencyKey: string | undefined;
        if (typeof workflow.idempotencyKey === "function") {
          idempotencyKey = workflow.idempotencyKey(triggerEvent);
        } else if (typeof workflow.idempotencyKey === "string") {
          idempotencyKey = workflow.idempotencyKey;
        }

        const runId = idempotencyKey
          ? workflowRunAggregateId(workflow.name, idempotencyKey)
          : crypto.randomUUID();

        try {
          await startAndRunWorkflow({
            runId,
            workflow,
            triggerEvent,
            triggerEventRef: {
              eventId: event.id,
              aggregateId: event.aggregateId,
              version: event.version,
            },
            ...(idempotencyKey && { idempotencyKey }),
            handlerCtx: ctx,
          });
        } catch (error) {
          // Failures outside the step loop (run-started append) have no step yet, so 0.
          const stepIndex =
            error instanceof WorkflowStepError ||
            error instanceof WorkflowSuspensionUnsupportedError
              ? error.stepIndex
              : 0;
          log.warn("workflow run failed", {
            runId,
            workflowName: workflow.name,
            stepIndex,
            error: String(error),
          });
          const failedPayload: WorkflowRunFailedPayload = {
            workflowName: workflow.name,
            stepIndex,
            error: describeWorkflowStepError(error),
          };
          await ctx.unsafeAppendEvent({
            aggregateId: runId,
            aggregateType: WORKFLOW_AGGREGATE_TYPE,
            type: WORKFLOW_RUN_FAILED_TYPE,
            payload: failedPayload,
          });
          // No rethrow: the failure is now durably recorded as
          // workflow.run-failed. Rethrowing would make the dispatcher
          // redeliver the same trigger event up to maxAttempts, re-running
          // every side-effect step and eventually killing the consumer.
        }
      },
    },
  } satisfies MultiStreamProjectionDefinition);
}
