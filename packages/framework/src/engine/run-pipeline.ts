// run-pipeline — executes a PipelineDef against (event, ctx) and
// returns a WriteResult.
//
// Execution model:
//   1. Build the immutable step list by invoking the pipeline closure.
//   2. Walk the list sequentially via runStepList. For each step:
//      - Look up the registered StepDef by kind.
//      - Build the live PipelineCtx (handler-ctx + accumulated steps + scope).
//      - Call step.run(args, ctx) — capture its return value.
//      - Detect the sentinel RETURN_RESULT_KEY → end pipeline with that
//        WriteResult; otherwise stash the value under resultKey if any.
//   3. If the loop exhausts without a `return` step, surface a loud error
//      so a forgotten r.step.return doesn't fall through silently.
//
// runStepList is exported for sub-step builders (branch/forEach in M.1.6)
// — they invoke it recursively over their own step-arrays, sharing the
// outer pipeline's stepsAcc + scopeAcc maps so sub-step results
// propagate up to subsequent top-level steps.
//
// Failure-strategy is "throw" only in M.1 — runPipeline lets thrown
// errors propagate to the dispatcher's catch which maps them to
// WriteFailure / HTTP. "return" / "skip" / fallback strategies land in
// later slices together with their own integration tests.

import { getStep } from "./define-step";
import { buildPipelineSteps } from "./pipeline";
import { RETURN_RESULT_KEY } from "./steps/return";
import type { KumikoEventTypeMap } from "./types/event-type-map";
import type { HandlerContext, WriteEvent, WriteResult } from "./types/handlers";
import type { PipelineCtx, PipelineDef, StepInstance } from "./types/step";

// Result of walking a step-list. "return" surfaces the WriteResult of an
// r.step.return; "exhausted" means all steps ran without hitting a return
// — the caller (top-level pipeline) treats that as an error, sub-step
// callers (branch/forEach) treat it as normal completion.
export type StepListOutcome =
  | { readonly kind: "return"; readonly result: WriteResult<unknown> }
  | { readonly kind: "exhausted" };

export async function runPipeline<TPayload, TData, TMap extends object = KumikoEventTypeMap>(
  pipelineDef: PipelineDef<TPayload, TData>,
  event: WriteEvent<TPayload>,
  handlerCtx: HandlerContext<TMap>,
): Promise<WriteResult<TData>> {
  const steps = buildPipelineSteps(pipelineDef, event);
  const stepsAcc: Record<string, unknown> = {};
  const scopeAcc: Record<string, unknown> = {};

  const outcome = await runStepList(steps, event, handlerCtx, stepsAcc, scopeAcc);
  if (outcome.kind === "return") {
    // RETURN_RESULT_KEY is only produced by r.step.return, whose run()
    // returns WriteResult<unknown>. The pipeline's generic TData is
    // bound at build time (defineWriteHandler ↔ pipeline<P, D>(...));
    // matching the runtime value to that compile-time type is the
    // contract user-side. Cast crosses that boundary.
    return outcome.result as WriteResult<TData>;
  }

  throw new Error(
    "Pipeline ended without an r.step.return(...) — every pipeline must explicitly return a WriteResult.",
  );
}

/**
 * Walk a step-list. Stateful in `stepsAcc` + `scopeAcc` (the caller's
 * mutable maps) — sub-step builders share those with the outer pipeline
 * so step results propagate. Returns either an early r.step.return
 * outcome or an "exhausted" signal.
 *
 * Sub-step builders (branch.run, forEach.run) re-enter via this
 * function. The same TMap-variance bridge applies — sub-steps treat
 * ctx as PipelineCtx<unknown, KumikoEventTypeMap>, the runtime value
 * is the outer's full HandlerContext.
 */
export async function runStepList<TPayload, TMap extends object = KumikoEventTypeMap>(
  steps: readonly StepInstance[],
  event: WriteEvent<TPayload>,
  handlerCtx: HandlerContext<TMap>,
  stepsAcc: Record<string, unknown>,
  scopeAcc: Record<string, unknown>,
): Promise<StepListOutcome> {
  for (const [i, instance] of steps.entries()) {
    const stepDef = getStep(instance.kind);
    if (!stepDef) {
      throw new Error(`Unknown step kind "${instance.kind}" at step index ${i}`);
    }

    const pipelineCtx: PipelineCtx<TPayload, TMap> = {
      ...handlerCtx,
      event,
      steps: stepsAcc,
      scope: scopeAcc,
    };

    const value = await stepDef.run(instance.args, pipelineCtx as unknown as PipelineCtx);

    const key = stepDef.resultKey?.(instance.args);
    if (key === RETURN_RESULT_KEY) {
      return { kind: "return", result: value as WriteResult<unknown> };
    }
    if (key !== undefined) {
      stepsAcc[key] = value;
    }
  }
  return { kind: "exhausted" };
}
