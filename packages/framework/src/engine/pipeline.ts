// pipeline() — public factory used in defineWriteHandler({ perform: pipeline(...) }).
//
// The closure receives { event, r } and returns the immutable list of
// step instances. `r` is the StepBuilder singleton; new tier-1 steps
// add a builder factory in steps/<x>.ts and expose it under
// `step` below.
//
// Note: `steps` and `scope` are NOT exposed at build time. They only
// exist on PipelineCtx (the resolver-side context) — at build time
// no step has run yet. Resolvers that need prior step results
// destructure them from the resolver's ctx, not from the closure args.

import { buildReturnStep } from "./steps/return";
import type { PipelineBuildCtx, PipelineDef, StepBuilder, StepInstance } from "./types/step";
import type { WriteEvent } from "./types/handlers";

const stepBuilder: StepBuilder = {
  step: {
    return: buildReturnStep,
  },
};

export function pipeline<TPayload = unknown, TData = unknown>(
  closure: (ctx: PipelineBuildCtx<TPayload>) => readonly StepInstance[],
): PipelineDef<TPayload, TData> {
  return {
    __kind: "pipeline",
    build: (ctx: PipelineBuildCtx<TPayload>) => closure(ctx),
  };
}

export function buildPipelineSteps<TPayload>(
  pipelineDef: PipelineDef<TPayload>,
  event: WriteEvent<TPayload>,
): readonly StepInstance[] {
  return pipelineDef.build({ event, r: stepBuilder });
}
