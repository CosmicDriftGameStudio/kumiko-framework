// r.step.compute — derive a value from the pipeline-context and stash
// it under `steps.<name>` for subsequent steps to consume.
//
// Typical use:
//   r.step.compute("startedAt", () => Temporal.Now.instant()),
//   r.step.compute("isPriority", ({ event }) => event.payload.tier === "Pro"),
//
// `compute` is the simplest non-trivial step — it shows how the
// `steps`-accumulator carries values forward across the pipeline. The
// runtime side is a single function call; the value of this step lies
// in being the smallest building block that exercises step-result
// threading end-to-end.
//
// Type-safety note: in M.1, `steps` is Record<string, unknown> — call
// sites cast or guard at the read end. Strict-typed result-key
// accumulation is a follow-up (see step-vocabulary.md M.1-Followups).

import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance } from "../types/step";

type ComputeStepArgs = {
  readonly name: string;
  readonly fn: (ctx: PipelineCtx) => unknown;
};

defineStep<ComputeStepArgs, unknown>({
  kind: "compute",
  defaultFailureStrategy: "throw",
  resultKey: (args) => args.name,
  run: (args, ctx) => args.fn(ctx),
});

export function buildComputeStep<TResult>(
  name: string,
  fn: (ctx: PipelineCtx) => TResult,
): StepInstance {
  return {
    kind: "compute",
    args: { name, fn } satisfies ComputeStepArgs,
  };
}
