// Resolver-call helpers — eliminate the typeof-narrow boilerplate that
// was repeated across 11 step files (return, compute, branch, forEach,
// read.findOne/findMany, aggregate.create/update/appendEvent,
// unsafeProjectionUpsert/Delete).
//
// Pattern before:
//   const value = typeof args.x === "function" ? args.x(ctx) : args.x;
//
// Pattern after:
//   const value = resolveRequired(args.x, ctx);
//
// The local-alias version (`const r = args.x; typeof r === "function" ? ...`)
// was needed to satisfy TS narrowing on a property-access; passing the
// arg through a function-call achieves the same narrowing trivially via
// the function-parameter binding.
//
// Followup #10 (closed at the M.1.6 cleanup-pass).

import type { PipelineCtx, StepResolver } from "../types/step";

/**
 * Resolve a required StepResolver — either a static value or a function.
 * Throws if `arg` is undefined; caller must guarantee presence.
 */
export function resolveRequired<T>(arg: StepResolver<T>, ctx: PipelineCtx): T {
  if (typeof arg === "function") {
    return (arg as (c: PipelineCtx) => T)(ctx);
  }
  return arg;
}

/**
 * Resolve an optional StepResolver — returns undefined when arg is
 * undefined, otherwise the resolved value.
 */
export function resolveOptional<T>(
  arg: StepResolver<T> | undefined,
  ctx: PipelineCtx,
): T | undefined {
  if (arg === undefined) return undefined;
  return resolveRequired(arg, ctx);
}
