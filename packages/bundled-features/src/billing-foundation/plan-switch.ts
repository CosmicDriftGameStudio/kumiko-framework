// Pre-checks shared by switch-plan and plan-switch-preview: both must agree on
// which subscription, provider and target price a plan switch means.
// Internal — not re-exported from index.ts.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import {
  assertBillingEnabled,
  findProviderPlugin,
  listCatalogProviders,
  type ResolvedProvider,
} from "./checkout-core.ts";
import { getSubscriptionForTenant, type SubscriptionView } from "./get-subscription-for-tenant.ts";
import { type ResolvedPlanPrice, resolvePlanPrices } from "./plan-catalog.ts";
import { type BillingPlanCatalog, canSwitchPlans } from "./types.ts";
import { isSwitchableSubscriptionStatus } from "./web/constants.ts";

export type PreparedPlanSwitch = {
  readonly provider: ResolvedProvider;
  readonly subscription: SubscriptionView;
  readonly target: NonNullable<ResolvedPlanPrice>;
  readonly allowedPriceIds: readonly string[];
};

export async function preparePlanSwitch(
  ctx: HandlerContext,
  catalog: BillingPlanCatalog,
  tier: string,
  handlerName: string,
): Promise<PreparedPlanSwitch> {
  const subscription = await getSubscriptionForTenant(ctx, ctx.user.tenantId);
  if (!subscription || !isSwitchableSubscriptionStatus(subscription.status)) {
    throw new ConflictError({
      i18nKey: "billing-foundation.errors.noActiveSubscription",
      message:
        "tenant has no switchable subscription; use billing-foundation:write:start-plan-checkout to start one",
    });
  }
  // providerSubscriptionId only exists at the subscription's own provider; a catalog that
  // no longer sells through that provider cannot switch it.
  const provider = findProviderPlugin(ctx, subscription.providerName);
  const isCatalogProvider =
    provider !== null &&
    listCatalogProviders(ctx, catalog).some((candidate) => candidate.name === provider.name);
  if (!provider || !isCatalogProvider) {
    throw new ConflictError({
      i18nKey: "billing-foundation.errors.providerMismatch",
      message: `tenant's active subscription is on provider "${subscription.providerName}", which the plan catalog does not sell through — switch-plan cannot switch across providers`,
    });
  }
  await assertBillingEnabled(ctx, provider.plugin, handlerName);
  if (subscription.cancelAt !== null) {
    throw new ConflictError({
      i18nKey: "billing-foundation.errors.cancellationScheduled",
      message:
        "subscription has a scheduled cancellation; reactivate it via billing-foundation:write:create-portal-session before switching plans",
    });
  }
  if (tier === subscription.tier) {
    throw new ConflictError({
      i18nKey: "billing-foundation.errors.alreadyOnPlan",
      message: `tenant is already on plan "${tier}"`,
    });
  }
  if (!canSwitchPlans(provider.plugin)) {
    throw new UnprocessableError("plan_switch_not_supported", {
      i18nKey: "billing-foundation.errors.planSwitchNotSupported",
      message: `subscription-foundation: provider "${subscription.providerName}" supports neither createPlanSwitchSession nor previewPlanSwitch + applyPlanSwitch`,
    });
  }

  const prices = await resolvePlanPrices(ctx, provider.plugin, catalog);
  const target = prices.get(tier);
  if (!target) {
    throw new UnprocessableError("price_unavailable", {
      i18nKey: "billing-foundation.errors.priceUnavailable",
      message: `subscription-foundation: no live price resolved for tier "${tier}"`,
    });
  }
  const allowedPriceIds = [...prices.values()]
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => p.priceId);
  return { provider, subscription, target, allowedPriceIds };
}
