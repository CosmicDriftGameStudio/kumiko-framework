// pipeline() — public factory used in defineWriteHandler({ perform: pipeline(...) }).
//
// The closure receives { event, r } and returns the immutable list of
// step instances. `r` is the StepBuilder singleton; new tier-1 steps
// add a builder factory in steps/<x>.ts and expose it under `step` below.
//
// `steps` and `scope` are NOT exposed at build time — they only exist on
// the resolver-side PipelineCtx (run-pipeline.ts). Resolvers that need
// prior step results destructure them from the resolver's ctx.

import { buildComputeStep } from "./steps/compute";
import { buildReturnStep } from "./steps/return";
import { buildUnsafeProjectionUpsertStep } from "./steps/unsafe-projection-upsert";
import type { WriteEvent } from "./types/handlers";
import type { PipelineBuildCtx, PipelineDef, StepBuilder, StepInstance } from "./types/step";

const stepBuilder: StepBuilder = {
  step: {
    return: buildReturnStep,
    compute: buildComputeStep,
    unsafeProjectionUpsert: buildUnsafeProjectionUpsertStep,
  },
};

export function pipeline<TPayload = unknown, TData = unknown>(
  closure: (ctx: PipelineBuildCtx<TPayload>) => readonly StepInstance[],
): PipelineDef<TPayload, TData> {
  return {
    __kind: "pipeline",
    build: closure,
  };
}

// Internal: invoked by run-pipeline.ts to materialise the step list.
// Not exported from the engine barrel — pipeline-internal plumbing.
export function buildPipelineSteps<TPayload>(
  pipelineDef: PipelineDef<TPayload>,
  event: WriteEvent<TPayload>,
): readonly StepInstance[] {
  return pipelineDef.build({ event, r: stepBuilder });
}
