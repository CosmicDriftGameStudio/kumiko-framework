// run-pipeline — executes a PipelineDef against (event, ctx) and
// returns a WriteResult. Drives the M.1.1 vertical slice.
//
// Execution model:
//   1. Build the immutable step list by invoking the pipeline closure.
//   2. Walk the list sequentially. For each step:
//      a) Look up the registered StepDef by kind.
//      b) Build the live PipelineCtx (handler-ctx + accumulated steps + scope).
//      c) Call step.run(args, ctx) — capture its return value.
//      d) On success: stash under steps[resultKey] (if a key exists).
//                     Detect the sentinel RETURN_RESULT_KEY → end pipeline
//                     with that WriteResult.
//      e) On thrown error: apply the per-instance onFailure (or default).
//   3. If the loop exhausts without a `return` step, the handler did
//      not produce a WriteResult — that's a programmer error. Surface it
//      as InternalError so the dispatcher can map it.

import { getStep } from "./define-step";
import { buildPipelineSteps } from "./pipeline";
import { RETURN_RESULT_KEY } from "./steps/return";
import type { KumikoEventTypeMap } from "./types/event-type-map";
import type { PipelineCtx, PipelineDef, StepFailureStrategy } from "./types/step";
import type { HandlerContext, WriteEvent, WriteResult } from "./types/handlers";

// TMap is propagated as a generic parameter (defaults to KumikoEventTypeMap)
// so the runner accepts HandlerContext<TMap> without forcing the caller to
// cast at the boundary. Step run() bodies in M.1 use appendEventUnsafe-style
// payloads (no TMap-aware appendEvent inside steps yet) so the variance
// concern doesn't leak into individual step definitions.
export async function runPipeline<TPayload, TData, TMap extends object = KumikoEventTypeMap>(
  pipelineDef: PipelineDef<TPayload, TData>,
  event: WriteEvent<TPayload>,
  handlerCtx: HandlerContext<TMap>,
): Promise<WriteResult<TData>> {
  const steps = buildPipelineSteps(pipelineDef, event);
  const stepsAcc: Record<string, unknown> = {};
  const scopeAcc: Record<string, unknown> = {};

  for (let i = 0; i < steps.length; i += 1) {
    const instance = steps[i];
    if (!instance) continue;
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

    let value: unknown;
    try {
      // Variance bridge at the step boundary: PipelineCtx<TPayload, TMap>
      // and PipelineCtx<unknown, KumikoEventTypeMap> are runtime-identical
      // — TMap is a purely compile-time type-arg for HandlerContext's
      // appendEvent. Step run() bodies in M.1 treat appendEvent as
      // appendEventUnsafe (string + unknown payload) and don't read
      // TMap-aware fields. When strict-typed appendEvent inside steps
      // lands (post-M.1.5), the per-step generic carries TMap through and
      // this cast goes away.
      value = await stepDef.run(instance.args, pipelineCtx as unknown as PipelineCtx);
    } catch (err) {
      const strategy: StepFailureStrategy =
        instance.onFailure ?? stepDef.defaultFailureStrategy;
      const handled = handleStepFailure<TData>(strategy, err, i, instance.kind);
      if (handled.kind === "return") return handled.result;
      if (handled.kind === "skip") continue;
      // "throw" or unhandled → re-throw, dispatcher's catch wraps as InternalError
      throw err;
    }

    const key = stepDef.resultKey?.(instance.args);
    if (key === RETURN_RESULT_KEY) {
      // r.step.return short-circuits the pipeline with its WriteResult.
      return value as WriteResult<TData>;
    }
    if (key !== undefined) {
      stepsAcc[key] = value;
    }
  }

  // No explicit return step — fail loud. Forcing pipelines to end with
  // r.step.return keeps the handler shape predictable; the alternative
  // (auto-wrap last step as success) hides typos like a forgotten return.
  throw new Error(
    "Pipeline ended without an r.step.return(...) — every pipeline must explicitly return a WriteResult.",
  );
}

type StepFailureOutcome<TData> =
  | { readonly kind: "return"; readonly result: WriteResult<TData> }
  | { readonly kind: "skip" }
  | { readonly kind: "rethrow" };

function handleStepFailure<TData>(
  strategy: StepFailureStrategy,
  err: unknown,
  index: number,
  kind: string,
): StepFailureOutcome<TData> {
  if (strategy === "throw") return { kind: "rethrow" };
  if (strategy === "skip") return { kind: "skip" };
  if (strategy === "return") {
    // Wrap the thrown error as a generic WriteFailure shape. The dispatcher's
    // KumikoError-aware catch path handles classification; here we surface
    // a minimal envelope so the pipeline can return cleanly without leaking
    // the error class. M.1.1 keeps this minimal — fine-grained mapping is
    // a job for a later pass once the Tier-2 step set is in place.
    void index;
    void kind;
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: "return",
      result: {
        isSuccess: false,
        error: {
          code: "internal_error",
          httpStatus: 500,
          i18nKey: "errors.internal_error",
          message,
          details: undefined,
        },
      } as unknown as WriteResult<TData>,
    };
  }
  // Fallback step — not implemented in M.1.1; surfaces explicit error so
  // a future slice can pick it up without silent acceptance.
  throw new Error("onFailure: { fallback } is not implemented in M.1");
}
