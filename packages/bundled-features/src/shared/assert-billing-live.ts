import type { ConfigKeyHandle, HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { FeatureDisabledError } from "@cosmicdrift/kumiko-framework/errors";

export async function assertBillingLive(
  ctx: HandlerContext,
  billingLiveHandle: ConfigKeyHandle<"boolean">,
  featureName: string,
  handlerName: string,
): Promise<void> {
  const live = ctx.config ? await ctx.config(billingLiveHandle) : undefined;
  if (live !== true) {
    throw new FeatureDisabledError(featureName, handlerName);
  }
}
