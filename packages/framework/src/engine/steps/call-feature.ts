// r.step.callFeature — typed sub-command on another Kumiko feature.
// Tier-2: requires r.requires.step("callFeature"). Sync (no dispatcher).
// Cross-tenant via opts.as (Sysadmin-role-checked at the dispatcher layer).

import { defineStep } from "../define-step";
import type { SessionUser } from "../types";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { resolveRequired } from "./_resolver-utils";

type CallFeatureArgs = {
  readonly name: string;
  readonly handler: string;
  readonly payload: StepResolver<unknown>;
  readonly as?: SessionUser;
};

defineStep<CallFeatureArgs, unknown>({
  kind: "callFeature",
  tier: 2,
  defaultFailureStrategy: "throw",
  resultKey: (args) => args.name,
  run: async (args, ctx: PipelineCtx) => {
    const payload = resolveRequired(args.payload, ctx);
    const result = args.as
      ? await ctx.writeAs(args.as, args.handler, payload)
      : await ctx.write(args.handler, payload);
    if (!result.isSuccess) {
      // Preserve the structured WriteFailure as `cause` so the
      // dispatcher's catch maps it back to a typed error response
      // (e.g. validation_failed stays validation_failed, not a
      // generic internal_error).
      const err = new Error(`callFeature("${args.handler}") returned failure`);
      (err as Error & { cause?: unknown }).cause = result.error;
      throw err;
    }
    return result.data;
  },
});

export function buildCallFeatureStep(
  name: string,
  opts: {
    readonly handler: string;
    readonly payload: StepResolver<unknown>;
    readonly as?: SessionUser;
  },
): StepInstance {
  return { kind: "callFeature", args: { name, ...opts } };
}
