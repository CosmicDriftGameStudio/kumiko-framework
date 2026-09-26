// Builds the BillingPlansResult a tenant-admin's billing-plans screen
// renders — resolves live provider prices for every catalog tier, the
// caller's current tier + subscription, and the action available per plan.
// Internal — not re-exported from index.ts.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  BillingPlanActions,
  DEFAULT_PURCHASE_ROLES,
  isSubscriptionBlockingCheckout,
  isSwitchableSubscriptionStatus,
  SubscriptionStatuses,
} from "./constants";
import { getSubscriptionForTenant } from "./get-subscription-for-tenant";
import type {
  BillingPlanCatalog,
  BillingPlansResult,
  BillingPlanView,
  ProviderPrice,
  SubscriptionProviderPlugin,
} from "./types";

function userHasAnyRole(userRoles: readonly string[], allowedRoles: readonly string[]): boolean {
  return allowedRoles.some((role) => userRoles.includes(role));
}

/** `catalog.purchaseRoles ?? DEFAULT_PURCHASE_ROLES` — the one place this
 *  fallback is spelled out; plan-catalog.ts and the start-plan-checkout/
 *  switch-plan handlers all call this instead of repeating the literal. */
export function purchaseRolesOf(
  catalog: Pick<BillingPlanCatalog, "purchaseRoles">,
): readonly string[] {
  return catalog.purchaseRoles ?? DEFAULT_PURCHASE_ROLES;
}

function invertPriceToTier(
  priceToTier: Readonly<Record<string, string>>,
): ReadonlyMap<string, readonly string[]> {
  const byTier = new Map<string, string[]>();
  for (const [priceId, tier] of Object.entries(priceToTier)) {
    const existing = byTier.get(tier);
    if (existing) {
      existing.push(priceId);
    } else {
      byTier.set(tier, [priceId]);
    }
  }
  return byTier;
}

type ResolvedPlanPrice = { readonly priceId: string; readonly price: ProviderPrice } | null;

/** Resolves one active, flat-amount price per plan tier. 0 or >1 active
 *  flat-amount prices for a tier is ambiguous — the caller can't tell which
 *  one the plan means — and resolves to null with a warning instead of an
 *  arbitrary pick. */
export async function resolvePlanPrices(
  ctx: HandlerContext,
  plugin: SubscriptionProviderPlugin,
  catalog: BillingPlanCatalog,
): Promise<ReadonlyMap<string, ResolvedPlanPrice>> {
  const result = new Map<string, ResolvedPlanPrice>();
  for (const tier of catalog.plans) result.set(tier, null);
  if (!plugin.retrievePrices || !plugin.priceToTier) return result;

  const byTier = invertPriceToTier(plugin.priceToTier);
  const allPriceIds = catalog.plans.flatMap((tier) => byTier.get(tier) ?? []);
  if (allPriceIds.length === 0) return result;

  let prices: readonly ProviderPrice[];
  try {
    prices = await plugin.retrievePrices(ctx, allPriceIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.log?.warn("billing-foundation: retrievePrices threw, all plan prices unavailable", {
      message,
    });
    return result;
  }
  const byPriceId = new Map(prices.map((p) => [p.priceId, p] as const));

  for (const tier of catalog.plans) {
    const priceIds = byTier.get(tier) ?? [];
    const active = priceIds
      .map((id) => byPriceId.get(id))
      .filter((p): p is ProviderPrice => p?.active === true && p.unitAmount !== null);
    if (active.length === 1) {
      const chosen = active[0];
      if (chosen) result.set(tier, { priceId: chosen.priceId, price: chosen });
    } else if (active.length > 1) {
      ctx.log?.warn(
        `billing-foundation: tier "${tier}" has ${active.length} active flat-amount prices — expected exactly one, price stays unavailable`,
      );
    }
  }
  return result;
}

type ActiveSubscription = {
  readonly status: string;
  readonly tier: string;
  readonly terminal: boolean;
};

/** One plan-row's action — pulled out of `buildBillingPlans`' map callback so
 *  that function's own complexity stays under the guard's budget. paymentPending
 *  is checked before the general unavailable-fallback: the tier a not-yet-
 *  confirmed checkout targets isn't `isCurrent` yet (tier sync only happens
 *  once Stripe confirms payment), so without this branch it would otherwise
 *  show a disabled/checkout CTA instead of the "still completing" hint. */
function resolvePlanAction(
  tier: string,
  isCurrent: boolean,
  price: unknown,
  enabled: boolean,
  canPurchase: boolean,
  subscription: ActiveSubscription | null,
  plugin: SubscriptionProviderPlugin,
): (typeof BillingPlanActions)[keyof typeof BillingPlanActions] {
  if (isCurrent) return BillingPlanActions.current;

  const isPaymentPendingForTier =
    subscription !== null &&
    !subscription.terminal &&
    subscription.status === SubscriptionStatuses.incomplete &&
    tier === subscription.tier;
  if (isPaymentPendingForTier) return BillingPlanActions.paymentPending;

  if (!enabled || !canPurchase || price === null) return BillingPlanActions.unavailable;

  if (!subscription || subscription.terminal) return BillingPlanActions.checkout;

  const canSwitch =
    isSwitchableSubscriptionStatus(subscription.status) &&
    tier !== subscription.tier &&
    plugin.createPlanSwitchSession;
  return canSwitch ? BillingPlanActions.switch : BillingPlanActions.unavailable;
}

export async function buildBillingPlans(
  ctx: HandlerContext,
  plugin: SubscriptionProviderPlugin,
  catalog: BillingPlanCatalog,
  now: () => Temporal.Instant,
): Promise<BillingPlansResult> {
  const currentTierValue = await catalog.resolveCurrentTier(ctx.db, ctx.user.tenantId);
  const enabled = plugin.isBillingEnabled ? await plugin.isBillingEnabled(ctx) : true;
  const resolvedPrices = enabled
    ? await resolvePlanPrices(ctx, plugin, catalog)
    : new Map<string, ResolvedPlanPrice>(catalog.plans.map((tier) => [tier, null]));

  const subscriptionView = await getSubscriptionForTenant(ctx, ctx.user.tenantId);
  const nowInstant = now();
  const subscription = subscriptionView
    ? {
        status: subscriptionView.status,
        tier: subscriptionView.tier,
        terminal: !isSubscriptionBlockingCheckout(subscriptionView, nowInstant),
      }
    : null;

  const purchaseRoles = purchaseRolesOf(catalog);
  const canPurchase = userHasAnyRole(ctx.user.roles, purchaseRoles);

  const plans: BillingPlanView[] = catalog.plans.map((tier) => {
    const isCurrent = tier === currentTierValue;
    const resolved = resolvedPrices.get(tier) ?? null;
    const price = resolved
      ? {
          unitAmount: resolved.price.unitAmount ?? 0,
          currency: resolved.price.currency,
          interval: resolved.price.interval,
          intervalCount: resolved.price.intervalCount,
        }
      : null;

    const action = resolvePlanAction(
      tier,
      isCurrent,
      price,
      enabled,
      canPurchase,
      subscription,
      plugin,
    );

    return {
      tier,
      labelKey: catalog.tierLabelKey(tier),
      price,
      benefits: catalog.benefits(tier),
      isCurrent,
      action,
    };
  });

  return {
    enabled,
    currentTier: { tier: currentTierValue, labelKey: catalog.tierLabelKey(currentTierValue) },
    subscription,
    canPurchase,
    plans,
  };
}
