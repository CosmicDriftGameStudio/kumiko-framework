// r.step.wait — suspend the workflow run for a given duration.
// Tier-3 / Workflow-only: only available inside defineWorkflow.
//
// Writes a kumiko:system:workflow.step.waiting event onto the workflow-run
// stream and returns the SUSPEND_SENTINEL to halt the pipeline. The
// Resume-Loop picks up waiting runs when the duration expires, writes
// workflow.step.resumed, and re-executes from the next step.
//
// The `for` resolver accepts ISO-8601 duration strings ("PT1H", "P1D")
// or absolute ISO timestamps ("2026-05-16T12:00:00Z").

import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { addDuration } from "./_duration-utils";
import { resolveRequired } from "./_resolver-utils";
import {
  SUSPEND_SENTINEL,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "./_step-dispatch-constants";

type WaitStepArgs = {
  readonly for: StepResolver<string>;
};

defineStep<WaitStepArgs, undefined | typeof SUSPEND_SENTINEL>({
  kind: "workflow.wait",
  tier: 3,
  defaultFailureStrategy: "throw",
  run: async (args, ctx: PipelineCtx): Promise<undefined | typeof SUSPEND_SENTINEL> => {
    if (!ctx.workflow) {
      throw new Error(
        "r.step.wait is only allowed inside defineWorkflow — " +
          "sync handlers cannot suspend (use r.step.webhook.send with mode: 'deferred' instead).",
      );
    }

    const duration = resolveRequired(args.for, ctx);

    const now = Temporal.Now.instant().toString();
    const wakeAt =
      duration.startsWith("P") || duration.startsWith("PT") ? addDuration(now, duration) : duration;

    await ctx.unsafeAppendEvent({
      aggregateId: ctx.workflow.runId,
      aggregateType: WORKFLOW_AGGREGATE_TYPE,
      type: WORKFLOW_WAITING_TYPE,
      payload: {
        wakeAt,
        stepIndex: ctx.workflow.stepIndex,
        workflowName: ctx.workflow.workflowName,
        // Trigger snapshot: pinned so the resume-loop re-feeds the
        // pipeline with what the original run saw. event-sourcing across
        // suspensions hinges on this being stable.
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

export function buildWaitStep(args: WaitStepArgs): StepInstance {
  return { kind: "workflow.wait", args };
}
