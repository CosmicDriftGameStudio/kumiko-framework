// run-pipeline — executes a PipelineDef against (event, ctx) and
// returns a WriteResult. Drives the M.1.1 vertical slice.
//
// Execution model:
//   1. Build the immutable step list by invoking the pipeline closure.
//   2. Walk the list sequentially. For each step:
//      - Look up the registered StepDef by kind.
//      - Build the live PipelineCtx (handler-ctx + accumulated steps).
//        `scope` is reserved for future forEach/branch sub-builders;
//        M.1.1 leaves it as an empty record.
//      - Call step.run(args, ctx) — capture its return value.
//      - Detect the sentinel RETURN_RESULT_KEY → end pipeline with that
//        WriteResult; otherwise stash the value under resultKey if any.
//   3. If the loop exhausts without a `return` step, surface a loud error
//      so a forgotten r.step.return doesn't fall through silently.
//
// Failure-strategy is "throw" only in M.1.1 — runPipeline lets thrown
// errors propagate to the dispatcher's catch which maps them to
// WriteFailure / HTTP. "return" / "skip" / fallback strategies land in
// later slices together with their own integration tests.

import { getStep } from "./define-step";
import { buildPipelineSteps } from "./pipeline";
import { RETURN_RESULT_KEY } from "./steps/return";
import type { KumikoEventTypeMap } from "./types/event-type-map";
import type { HandlerContext, WriteEvent, WriteResult } from "./types/handlers";
import type { PipelineCtx, PipelineDef } from "./types/step";

export async function runPipeline<TPayload, TData, TMap extends object = KumikoEventTypeMap>(
  pipelineDef: PipelineDef<TPayload, TData>,
  event: WriteEvent<TPayload>,
  handlerCtx: HandlerContext<TMap>,
): Promise<WriteResult<TData>> {
  const steps = buildPipelineSteps(pipelineDef, event);
  const stepsAcc: Record<string, unknown> = {};
  const scopeAcc: Record<string, unknown> = {};

  for (const [i, instance] of steps.entries()) {
    const stepDef = getStep(instance.kind);
    if (!stepDef) {
      throw new Error(`Unknown step kind "${instance.kind}" at pipeline index ${i}`);
    }

    const pipelineCtx: PipelineCtx<TPayload, TMap> = {
      ...handlerCtx,
      event,
      steps: stepsAcc,
      scope: scopeAcc,
    };

    // Variance bridge: PipelineCtx<TPayload, TMap> and
    // PipelineCtx<unknown, KumikoEventTypeMap> are runtime-identical —
    // TMap is purely compile-time (HandlerContext.appendEvent). Steps in
    // M.1 use unsafeAppendEvent-semantics and don't read TMap-aware
    // fields. The cast disappears once strict-typed appendEvent inside
    // steps lands (post-M.1.5).
    const value = await stepDef.run(instance.args, pipelineCtx as unknown as PipelineCtx);

    const key = stepDef.resultKey?.(instance.args);
    if (key === RETURN_RESULT_KEY) {
      // RETURN_RESULT_KEY is only produced by r.step.return, whose run()
      // returns WriteResult<unknown>. The pipeline's generic TData is
      // bound at build time (defineWriteHandler ↔ pipeline<P, D>(...));
      // matching the runtime value to that compile-time type is the
      // contract user-side. Cast crosses that boundary.
      return value as WriteResult<TData>;
    }
    if (key !== undefined) {
      stepsAcc[key] = value;
    }
  }

  throw new Error(
    "Pipeline ended without an r.step.return(...) — every pipeline must explicitly return a WriteResult.",
  );
}
