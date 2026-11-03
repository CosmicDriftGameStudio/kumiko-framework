import type { ConfigKeyHandle, HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { FeatureDisabledError } from "@cosmicdrift/kumiko-framework/errors";

export async function isBillingLive(
  ctx: HandlerContext,
  billingLiveHandle: ConfigKeyHandle<"boolean">,
): Promise<boolean> {
  const live = ctx.config ? await ctx.config(billingLiveHandle) : undefined;
  return live === true;
}

export async function assertBillingLive(
  ctx: HandlerContext,
  billingLiveHandle: ConfigKeyHandle<"boolean">,
  featureName: string,
  handlerName: string,
): Promise<void> {
  if (!(await isBillingLive(ctx, billingLiveHandle))) {
    throw new FeatureDisabledError(featureName, handlerName);
  }
}
