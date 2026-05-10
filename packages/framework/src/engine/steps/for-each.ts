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

type ForEachArgs<TItem = unknown> = {
  readonly over: StepResolver<readonly TItem[]>;
  readonly as: string;
  readonly do: readonly StepInstance[];
  // Reserved for Followup #12. Today only `1` is accepted; adding `N`
  // requires the work documented in step-vocabulary.md Q16.
  readonly concurrency?: 1;
};

defineStep<ForEachArgs, void>({
  kind: "forEach",
  defaultFailureStrategy: "throw",
  run: async (args, ctx: PipelineCtx) => {
    const items = typeof args.over === "function" ? args.over(ctx) : args.over;
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
        const outcome = await runStepList(args.do, ctx.event, ctx, stepsAcc, scopeAcc);
        if (outcome.kind === "return") {
          throw new Error("r.step.return is not allowed inside r.step.forEach.do (Q12)");
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

// Mirrors the Q12 guard in branch.ts. Kept inline rather than shared
// because both files are small and the guard's wording is step-specific
// (different error-message location string). Extract when a third
// sub-step-builder lands.
function validateNoReturnSteps(steps: readonly StepInstance[], where: string): void {
  for (const step of steps) {
    if (step.kind === "return") {
      throw new Error(
        `r.step.return is not allowed inside ${where} — branch/forEach are side-effect containers (Q12). ` +
          `Restructure the pipeline so the return happens at the top level.`,
      );
    }
  }
}
