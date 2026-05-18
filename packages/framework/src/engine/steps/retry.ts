// r.step.retry — wrap a sub-pipeline with retry+backoff.
// Tier-3 / Workflow-only: only available inside defineWorkflow.
//
// On first execution, runs the `do` sub-pipeline inside a try-catch.
// If it throws and retries remain, writes a kumiko:system:workflow.retry.scheduled
// event and returns SUSPEND_SENTINEL to suspend. The Resume-Loop picks it up
// after the backoff duration and re-enters the step at the same index.
// After all attempts exhausted, the original error propagates.

import { defineStep } from "../define-step";
import { runStepList } from "../run-pipeline";
import type { PipelineCtx, StepInstance } from "../types/step";
import {
  SUSPEND_SENTINEL,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
} from "./_step-dispatch-constants";

type RetryStepArgs = {
  readonly times: number;
  readonly backoff: "exponential" | "linear";
  readonly do: readonly StepInstance[];
};

defineStep<RetryStepArgs, undefined | typeof SUSPEND_SENTINEL>({
  kind: "workflow.retry",
  tier: 3,
  defaultFailureStrategy: "throw",
  subPaths: ["do"],
  run: async (args, ctx: PipelineCtx): Promise<undefined | typeof SUSPEND_SENTINEL> => {
    if (!ctx.workflow) {
      throw new Error(
        "r.step.retry is only allowed inside defineWorkflow — " + "sync handlers cannot suspend.",
      );
    }

    const stepsAcc = ctx.steps as Record<string, unknown>;
    const scopeAcc = ctx.scope as Record<string, unknown>;
    const maxAttempts = args.times;
    const attempt = ctx.workflow.retryAttempt ?? 1;

    try {
      await runStepList(args.do, ctx.event, ctx, stepsAcc, scopeAcc, ctx.workflow);
      return undefined;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      const backoffMs = calculateBackoff(attempt, args.backoff);
      const wakeAt = Temporal.Now.instant().add({ milliseconds: backoffMs }).toString();

      await ctx.unsafeAppendEvent({
        aggregateId: ctx.workflow.runId,
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        type: WORKFLOW_RETRY_SCHEDULED_TYPE,
        payload: {
          stepIndex: ctx.workflow.stepIndex,
          attempt,
          maxAttempts,
          wakeAt,
          workflowName: ctx.workflow.workflowName,
          error: String(error),
          triggerEventType: ctx.event.type,
          triggerPayload: ctx.event.payload,
          ...(ctx.workflow.definitionFingerprint && {
            definitionFingerprint: ctx.workflow.definitionFingerprint,
          }),
        },
      });

      return SUSPEND_SENTINEL;
    }
  },
});

export function buildRetryStep(args: RetryStepArgs): StepInstance {
  return { kind: "workflow.retry", args };
}

export function calculateBackoff(attempt: number, strategy: "exponential" | "linear"): number {
  const baseMs = 10_000;
  if (strategy === "linear") {
    return baseMs * attempt;
  }
  return baseMs * 2 ** (attempt - 1);
}
