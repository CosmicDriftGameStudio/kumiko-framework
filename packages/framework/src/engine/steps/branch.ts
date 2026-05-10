// r.step.branch — conditional sub-pipeline execution.
//
// Evaluates the `if` resolver, runs the `then` step-array if truthy,
// otherwise the `else` step-array (if provided). Branch is a
// side-effect container: it doesn't surface a result-key, doesn't
// allow mid-flight `r.step.return`. Use it to gate ES-mutations or
// projection-writes on a condition derived from prior steps.
//
// ```ts
// r.step.branch({
//   if: ({ steps }) => (steps["user"] as User | null) !== null,
//   onTrue: [r.step.aggregate.appendEvent({...})],
//   onFalse: [r.step.unsafeProjectionUpsert({...})],
// })
// ```
//
// Naming-note (Q14 revised): `onTrue`/`onFalse` instead of `then`/`else`
// because Biome's `noThenProperty` lint flags `then` as a thenable-trap
// (await-on-the-args-object would invoke the array, not awaited
// resolution). `if` remains as JS-keyword-as-property — string-key access
// is allowed and reads as natural English.
//
// Sub-pipeline-form (Q11): `onTrue` / `onFalse` are static StepInstance
// arrays — `r` is captured from the outer pipeline closure, no nested
// r-arg. Boot-validator walks them recursively (Q17). Build-time guard
// (Q12) rejects nested `r.step.return` — branch is not a mid-flight
// exit (would trigger the discriminated-union TData-Inference trap).

import { defineStep } from "../define-step";
import { runStepList } from "../run-pipeline";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { validateNoReturnSteps } from "./_no-return-guard";
import { resolveRequired } from "./_resolver-utils";

type BranchArgs = {
  readonly if: StepResolver<boolean>;
  readonly onTrue: readonly StepInstance[];
  readonly onFalse?: readonly StepInstance[];
};

defineStep<BranchArgs, void>({
  kind: "branch",
  defaultFailureStrategy: "throw",
  // Self-register the sub-pipeline arg-paths so the boot-validator's
  // walkAllSteps can recurse into branches without a hardcoded list.
  // Followup #15.
  subPaths: ["onTrue", "onFalse"],
  run: async (args, ctx: PipelineCtx) => {
    const condition = resolveRequired(args.if, ctx);
    const branchSteps = condition ? args.onTrue : (args.onFalse ?? []);

    // Recursive sub-step execution. The acc-maps in ctx are typed
    // Readonly for the public-facing PipelineCtx (resolvers shouldn't
    // mutate them directly), but the runtime objects are the same
    // mutable maps that runPipeline owns. Casting back to mutable here
    // is a framework-internal boundary, not a user-API boundary.
    const stepsAcc = ctx.steps as Record<string, unknown>;
    const scopeAcc = ctx.scope as Record<string, unknown>;

    const outcome = await runStepList(branchSteps, ctx.event, ctx, stepsAcc, scopeAcc);
    if (outcome.kind === "return") {
      // Build-time guard (validateNoReturnSteps) rejects any return-step
      // inside onTrue/onFalse. If we land here at runtime, someone
      // hand-crafted a StepInstance with kind="return" and bypassed the
      // builder. Fail loud rather than silently bubbling the return up to
      // the outer pipeline (would shadow Q12).
      throw new Error("r.step.return is not allowed inside r.step.branch onTrue/onFalse (Q12)");
    }
  },
});

export function buildBranchStep(args: BranchArgs): StepInstance {
  validateNoReturnSteps(args.onTrue, "r.step.branch.onTrue");
  if (args.onFalse) validateNoReturnSteps(args.onFalse, "r.step.branch.onFalse");
  return { kind: "branch", args };
}
