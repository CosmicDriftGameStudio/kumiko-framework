import type { UserDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";

// The defaults feature registers hooks for OPTIONAL source features
// (optionalRequires). When the source isn't mounted its tables don't exist,
// and the export runner has no try/catch around hooks — a query against a
// missing table would kill the whole export job. Every gated hook must
// early-return on this check before touching the source's tables.
export function featureMounted(ctx: UserDataHookCtx, featureName: string): boolean {
  return ctx.registry.getFeature(featureName) !== undefined;
}
