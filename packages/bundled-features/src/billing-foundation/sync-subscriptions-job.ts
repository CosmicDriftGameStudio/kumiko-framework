import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { SubscriptionFoundationHandlers } from "./web/constants.ts";

// Daily drift sync in the maintenance window: catches provider-side changes that never
// reached us as a webhook; a found change appends a state event and the
// subscription-tier-sync job takes the tier along. Not on boot, so a deploy does not
// fire one provider call per tenant. Registered unconditionally, same reasoning as the
// sync-subscription write-handler.
export function registerSyncSubscriptionsJob(r: FeatureRegistrar): void {
  r.job({
    name: "sync-subscriptions",
    trigger: { maintenance: true },
    perTenant: true,
    handler: async (_payload, ctx) => {
      const result = await ctx.dispatch.write(SubscriptionFoundationHandlers.syncSubscription, {});
      if (!result.isSuccess) {
        throw new Error(
          `billing-foundation:sync-subscriptions: sync-subscription write failed: ${JSON.stringify(result.error)}`,
        );
      }
      ctx.obs.log.info(`[billing-foundation:sync-subscriptions] ${JSON.stringify(result.data)}`);
    },
  });
}
