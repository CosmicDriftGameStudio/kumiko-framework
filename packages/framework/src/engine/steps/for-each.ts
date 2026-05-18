// r.step.forEach — iterate a sub-pipeline over an array.
//
// The sub-pipeline (`do`) runs once per item; the current item lands
// under `scope[as]` for resolvers inside `do` to read. After the loop,
// `scope[as]` is restored to its prior value (or deleted if it didn't
// exist before) — scope-keys are forEach-local, not bleeding into
// subsequent top-level steps.
//
// ```ts
// r.step.forEach({
//   over: ({ steps }) => steps["componentIds"] as string[],
//   as: "componentId",
//   do: [
//     r.step.unsafeProjectionUpsert({
//       table: incidentComponentsTable,
//       on: ["incidentId", "componentId"],
//       row: ({ scope, steps }) => ({
//         incidentId: (steps["incident"] as { id: string }).id,
//         componentId: scope["componentId"] as string,
//       }),
//     }),
//   ],
// })
// ```
//
// M.1.6 supports `concurrency: 1` only (sequential). Concurrent
// execution (Promise.all-style) is Followup #12 — TX-sharing,
// AbortSignal-cancellation, and lifecycle-hook ordering each warrant
// their own audit cycle (Q16).
//
// Q15: `as` is required — without it, the current item is unreachable
// from the sub-pipeline's resolvers. Q12: r.step.return inside `do` is
// rejected at build time (would trigger the discriminated-union
// TData-Inference trap).

import { defineStep } from "../define-step";
import { runStepList } from "../run-pipeline";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { validateNoReturnSteps } from "./_no-return-guard";
import { resolveRequired } from "./_resolver-utils";
import { SUSPEND_SENTINEL } from "./_step-dispatch-constants";

type ForEachArgs<TItem = unknown> = {
  readonly over: StepResolver<readonly TItem[]>;
  readonly as: string;
  readonly do: readonly StepInstance[];
  // Reserved for Followup #12. Today only `1` is accepted; adding `N`
  // requires the work documented in step-vocabulary.md Q16.
  readonly concurrency?: 1;
};

defineStep<ForEachArgs, undefined | typeof SUSPEND_SENTINEL>({
  kind: "forEach",
  defaultFailureStrategy: "throw",
  subPaths: ["do"],
  run: async (args, ctx: PipelineCtx) => {
    const items = resolveRequired(args.over, ctx);
    if (!Array.isArray(items)) {
      throw new Error(`r.step.forEach: 'over' resolver must return an array (got ${typeof items})`);
    }

    // Mutable-acc cast — same framework-internal boundary as branch.run.
    // The runtime objects are the maps that runPipeline owns; readonly
    // typing in PipelineCtx is for resolver-API hygiene.
    const stepsAcc = ctx.steps as Record<string, unknown>;
    const scopeAcc = ctx.scope as Record<string, unknown>;

    // Save-and-restore so the scope-key is forEach-local. Without this,
    // a nested `r.step.compute` reading scope[as] AFTER the forEach
    // would silently see the last iteration's item.
    const hadKey = Object.hasOwn(scopeAcc, args.as);
    const previousValue = scopeAcc[args.as];

    try {
      for (const item of items) {
        scopeAcc[args.as] = item;
        const outcome = await runStepList(
          args.do,
          ctx.event,
          ctx,
          stepsAcc,
          scopeAcc,
          ctx.workflow,
        );
        if (outcome.kind === "return") {
          throw new Error("r.step.return is not allowed inside r.step.forEach.do (Q12)");
        }
        if (outcome.kind === "suspended") {
          return SUSPEND_SENTINEL;
        }
      }
    } finally {
      if (hadKey) {
        scopeAcc[args.as] = previousValue;
      } else {
        delete scopeAcc[args.as];
      }
    }
  },
});

export function buildForEachStep<TItem = unknown>(args: ForEachArgs<TItem>): StepInstance {
  validateNoReturnSteps(args.do, "r.step.forEach.do");
  if (args.concurrency !== undefined && args.concurrency !== 1) {
    throw new Error(
      `r.step.forEach: concurrency=${args.concurrency} not supported in M.1.6 (only 1). ` +
        `Concurrent forEach is Followup #12 — TX-sharing, AbortSignal, hook-ordering each need their own slice.`,
    );
  }
  return { kind: "forEach", args };
}
