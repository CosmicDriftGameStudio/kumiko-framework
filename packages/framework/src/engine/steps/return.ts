// r.step.return — terminate the pipeline with an explicit WriteResult.
//
// Most pipelines end with a return so the handler shape stays explicit
// (`isSuccess: true, data: {...}`). When a pipeline omits an explicit
// return, run-pipeline throws — silent fallthrough would mask the most
// common authoring mistake (forgotten r.step.return at the end).

import { defineStep } from "../define-step";
import type { WriteResult } from "../types/handlers";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { resolveRequired } from "./_resolver-utils";

type ReturnStepArgs = {
  readonly resolver: StepResolver<WriteResult<unknown>>;
};

// Sentinel result-key consumed by run-pipeline to detect "this step
// terminates the pipeline with this WriteResult". Leading double-underscore
// is reserved for runtime-internal results — user code can't collide.
export const RETURN_RESULT_KEY = "__return";

defineStep<ReturnStepArgs, WriteResult<unknown>>({
  kind: "return",
  defaultFailureStrategy: "throw",
  resultKey: () => RETURN_RESULT_KEY,
  // @wrapper-known semantic-alias
  run: (args, ctx: PipelineCtx) => resolveRequired(args.resolver, ctx),
});

export function buildReturnStep<TData>(resolver: StepResolver<WriteResult<TData>>): StepInstance {
  return {
    kind: "return",
    args: { resolver } satisfies ReturnStepArgs,
  };
}
