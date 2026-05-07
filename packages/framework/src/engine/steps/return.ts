// r.step.return — terminate the pipeline with an explicit WriteResult.
//
// The simplest tier-1 step. Wraps a resolver that produces the
// pipeline's final WriteResult. Run-time picks up the resolved value
// and ends the pipeline immediately — subsequent steps are not executed.
//
// Most pipelines end with a return so the handler shape stays explicit
// (`isSuccess: true, data: {...}`). When a pipeline omits an explicit
// return, the runner uses the last step's bare result wrapped as success.

import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import type { WriteResult } from "../types/handlers";

type ReturnStepArgs = {
  readonly resolver: StepResolver<WriteResult<unknown>>;
};

// Sentinel result-key consumed by run-pipeline to detect "this step
// terminates the pipeline with this WriteResult". Choose a key the
// user can never collide with by accident — leading double-underscore
// is reserved for runtime-internal results.
export const RETURN_RESULT_KEY = "__return";

export const returnStepDef = defineStep<ReturnStepArgs, WriteResult<unknown>>({
  kind: "return",
  defaultFailureStrategy: "throw",
  resultKey: () => RETURN_RESULT_KEY,
  run: (args, ctx) => {
    const value =
      typeof args.resolver === "function"
        ? (args.resolver as (c: PipelineCtx) => WriteResult<unknown>)(ctx)
        : args.resolver;
    return value;
  },
});

/**
 * Step-builder factory. Constructs a StepInstance — the actual run()
 * call happens in run-pipeline against the registered StepDef.
 */
export function buildReturnStep<TData>(
  resolver: StepResolver<WriteResult<TData>>,
): StepInstance {
  return {
    kind: "return",
    args: { resolver } satisfies ReturnStepArgs,
  };
}
