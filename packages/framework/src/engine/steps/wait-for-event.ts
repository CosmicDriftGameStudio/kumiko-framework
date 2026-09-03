// r.step.waitForEvent — suspend the workflow until a matching domain event
// is observed, or a timeout expires.
// Tier-3 / Workflow-only: only available inside defineWorkflow.
//
// Writes a kumiko:system:workflow.step.waiting-for-event event onto the
// workflow-run stream and returns the SUSPEND_SENTINEL. The Resume-Loop
// monitors for matching events (via subscription or poll); when matched,
// it writes workflow.step.resumed with the matched event's data.
//
// The `match` resolver is optional — when omitted, any event of the given
// type resumes the workflow. When provided, it resolves to a serializable
// EventMatch AST (not a closure) that is persisted into the waiting event's
// payload; the Resume-Loop evaluates it via evaluateEventMatch against the
// candidate event's payload.

import { defineStep } from "../define-step";
import type { EventMatch, PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { addDuration } from "./_duration-utils";
import { resolveOptional, resolveRequired } from "./_resolver-utils";
import {
  SUSPEND_SENTINEL,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
} from "./_step-dispatch-constants";

type WaitForEventArgs = {
  readonly event: string;
  readonly match?: StepResolver<EventMatch>;
  readonly timeout: StepResolver<string>;
};

defineStep<WaitForEventArgs, undefined | typeof SUSPEND_SENTINEL>({
  kind: "workflow.waitForEvent",
  tier: 3,
  defaultFailureStrategy: "throw",
  run: async (args, ctx: PipelineCtx): Promise<undefined | typeof SUSPEND_SENTINEL> => {
    if (!ctx.workflow) {
      throw new Error(
        "r.step.waitForEvent is only allowed inside defineWorkflow — " +
          "sync handlers cannot suspend.",
      );
    }

    const timeout = resolveRequired(args.timeout, ctx);
    const resolvedMatch = resolveOptional(args.match, ctx);

    const now = Temporal.Now.instant().toString();
    const timeoutAt =
      timeout.startsWith("P") || timeout.startsWith("PT") ? addDuration(now, timeout) : timeout;

    await ctx.unsafeAppendEvent({
      aggregateId: ctx.workflow.runId,
      aggregateType: WORKFLOW_AGGREGATE_TYPE,
      type: WORKFLOW_WAITING_FOR_EVENT_TYPE,
      payload: {
        eventType: args.event,
        ...(resolvedMatch && { match: resolvedMatch }),
        timeoutAt,
        stepIndex: ctx.workflow.stepIndex,
        workflowName: ctx.workflow.workflowName,
        triggerEventType: ctx.event.type,
        triggerPayload: ctx.event.payload,
        ...(ctx.workflow.definitionFingerprint && {
          definitionFingerprint: ctx.workflow.definitionFingerprint,
        }),
      },
    });

    return SUSPEND_SENTINEL;
  },
});

export function buildWaitForEventStep(args: WaitForEventArgs): StepInstance {
  return { kind: "workflow.waitForEvent", args };
}
