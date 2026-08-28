// event-trigger — MultiStreamProjection that listens for domain events and
// starts + runs a workflow when the event matches its trigger.
//
// Registration pattern:
//   registerEventTrigger(r, myWorkflow)
//
// The MSP apply-fn runs in the dispatcher's own tx, so `workflow.run-started`
// plus the synchronous portion of the pipeline land atomically. Any throw
// from startAndRunWorkflow — including WorkflowSuspensionUnsupportedError,
// since no resume-loop is mounted yet (framework#2480) — is recorded as
// `workflow.run-failed` and rethrown so the dispatcher's retry/dead-letter
// handling still applies.

import type {
  FeatureRegistrar,
  MultiStreamProjectionDefinition,
  WorkflowDefinition,
  WriteEvent,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { workflowRunAggregateId } from "./aggregate-id";
import { startAndRunWorkflow, type WorkflowRunFailedPayload } from "./runner";

export function registerEventTrigger(r: FeatureRegistrar, workflow: WorkflowDefinition): void {
  // skip: cron-triggered workflows have no domain event to project off — they
  // need a scheduler, not an MSP, so there is nothing to register here.
  if (workflow.trigger.kind !== "event") return;

  const eventType = workflow.trigger.eventType;

  r.multiStreamProjection({
    name: `workflow-${workflow.name}`,
    apply: {
      [eventType]: async (event, _tx, ctx) => {
        // skip: unreachable — the guard above already established this, but the
        // closure does not carry that narrowing, and re-narrowing here keeps
        // `trigger.filter` below typed without a cast.
        if (workflow.trigger.kind !== "event") return;
        if (workflow.trigger.filter) {
          const matches = workflow.trigger.filter(event as never);
          // skip: the workflow's own trigger filter rejected this event — not
          // this run's concern, so no run is started and nothing is recorded.
          if (!matches) return;
        }

        // @cast-boundary msp-to-write-event — the MSP delivers a StoredEvent
        // (event-store shape); the workflow runner expects a WriteEvent
        // (handler shape). The fields workflow steps read (type, payload)
        // overlap exactly — the missing `.user` field is acceptable because
        // workflow triggers run system-level, not user-scoped.
        const triggerEvent = event as unknown as WriteEvent;
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
            ...(idempotencyKey && { idempotencyKey }),
            // @cast-boundary msp-to-handler-ctx — MultiStreamApplyContext only
            // exposes unsafeAppendEvent/loadAggregate, a subset of
            // HandlerContext. The step vocabulary this runner drives (wait,
            // compute, return) only ever calls unsafeAppendEvent on it.
            handlerCtx: ctx as never,
          });
        } catch (error) {
          const failedPayload: WorkflowRunFailedPayload = {
            workflowName: workflow.name,
            stepIndex: 0,
            error: String(error),
          };
          await ctx.unsafeAppendEvent({
            aggregateId: runId,
            aggregateType: WORKFLOW_AGGREGATE_TYPE,
            type: WORKFLOW_RUN_FAILED_TYPE,
            payload: failedPayload,
          });
          throw error;
        }
      },
    },
  } satisfies MultiStreamProjectionDefinition);
}
