// pipeline() — public factory used in defineWriteHandler({ perform: pipeline(...) }).
//
// The factory takes a closure that, given { event, r }, returns the
// list of step instances to execute. The closure is invoked once per
// handler-call (not per step) by run-pipeline.ts.
//
// This file also constructs the `r` (StepBuilder) singleton handed to
// the closure. New tier-1 steps add a builder factory in steps/<x>.ts
// and expose it under the `step` namespace below.

import { buildReturnStep } from "./steps/return";
import type { PipelineBuildCtx, PipelineDef, StepBuilder, StepInstance } from "./types/step";
import type { WriteEvent } from "./types/handlers";

// Singleton step-builder. Stateless — every step factory just constructs
// a StepInstance. Sharing one instance across all handlers is fine
// because StepBuilder has no per-pipeline state.
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

/**
 * Internal helper used by run-pipeline to invoke the closure with the
 * right shape. Kept here (not in run-pipeline) so the StepBuilder
 * construction stays colocated with the public factory.
 */
export function buildPipelineSteps<TPayload>(
  pipelineDef: PipelineDef<TPayload>,
  event: WriteEvent<TPayload>,
): readonly StepInstance[] {
  return pipelineDef.build({ event, r: stepBuilder });
}
