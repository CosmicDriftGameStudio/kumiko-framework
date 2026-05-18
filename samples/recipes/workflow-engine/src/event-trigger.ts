// event-trigger — MultiStreamProjection that listens for domain events and
// starts + runs a workflow when the event matches a trigger.
//
// Registration pattern:
//   registerEventTrigger(r, userOnboardingWorkflow)
//
// The MSP apply-fn runs in the dispatcher's tx, so the run.started event
// plus the synchronous portion of the pipeline land atomically. If the
// pipeline hits a Tier-3 suspension (wait/waitForEvent/retry), the apply
// commits with the WAITING event written; the resume-loop wakes it later.

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
import { v4 as uuid } from "uuid";
import { startAndRunWorkflow } from "./workflow-runner";

export function registerEventTrigger(r: FeatureRegistrar, workflow: WorkflowDefinition): void {
  if (workflow.trigger.kind !== "event") return;

  const eventType = workflow.trigger.eventType;

  r.multiStreamProjection({
    name: `workflow-${workflow.name}`,
    apply: {
      [eventType]: async (event, _tx, ctx) => {
        if (workflow.trigger.kind !== "event") return;
        if (workflow.trigger.filter) {
          const matches = workflow.trigger.filter(event as never);
          if (!matches) return;
        }

        // @cast-boundary msp-to-write-event — MSP receives StoredEvent
        // (event-store shape), workflow runner expects WriteEvent (handler
        // shape). The fields workflow steps read (type, payload) overlap
        // exactly; the missing `.user` field on StoredEvent is acceptable
        // because workflow triggers run system-level, not user-scoped.
        const triggerEvent = event as unknown as WriteEvent;
        let idempotencyKey: string | undefined;
        if (typeof workflow.idempotencyKey === "function") {
          idempotencyKey = workflow.idempotencyKey(triggerEvent);
        } else if (typeof workflow.idempotencyKey === "string") {
          idempotencyKey = workflow.idempotencyKey;
        }

        const runId = idempotencyKey
          ? `wf-${workflow.name}-${idempotencyKey}`
          : `wf-${workflow.name}-${uuid()}`;

        try {
          await startAndRunWorkflow({
            runId,
            workflow,
            triggerEvent,
            ...(idempotencyKey && { idempotencyKey }),
            handlerCtx: ctx as never,
          });
        } catch (error) {
          await (
            ctx as never as { unsafeAppendEvent: (a: unknown) => Promise<void> }
          ).unsafeAppendEvent({
            aggregateId: runId,
            aggregateType: WORKFLOW_AGGREGATE_TYPE,
            type: WORKFLOW_RUN_FAILED_TYPE,
            payload: {
              workflowName: workflow.name,
              stepIndex: 0,
              error: String(error),
            },
          });
          throw error;
        }
      },
    },
  } satisfies MultiStreamProjectionDefinition);
}
