// Builds the BillingPlansResult a tenant-admin's billing-plans screen
// renders — resolves live provider prices for every catalog tier, the
// caller's current tier + subscription, and the action available per plan.
// Internal — not re-exported from index.ts.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { isPluginBillingEnabled } from "./checkout-core.js";
import {
  BillingPlanActions,
  DEFAULT_PURCHASE_ROLES,
  isSubscriptionBlockingCheckout,
  isSwitchableSubscriptionStatus,
  SubscriptionStatuses,
} from "./constants.js";
import { getSubscriptionForTenant } from "./get-subscription-for-tenant.js";
import type {
  BillingPlanCatalog,
  BillingPlansResult,
  BillingPlanView,
  ProviderPrice,
  SubscriptionProviderPlugin,
} from "./types.js";

function userHasAnyRole(userRoles: readonly string[], allowedRoles: readonly string[]): boolean {
  return allowedRoles.some((role) => userRoles.includes(role));
}

/** `catalog?.purchaseRoles ?? DEFAULT_PURCHASE_ROLES` — the one place this
 *  fallback is spelled out; plan-catalog.ts and the start-plan-checkout/
 *  switch-plan/create-portal-session handlers all call this instead of
 *  repeating the literal. Accepts `undefined` so create-portal-session
 *  (mounted with or without a catalog) doesn't need its own fallback. */
export function purchaseRolesOf(
  catalog: Pick<BillingPlanCatalog, "purchaseRoles"> | undefined,
): readonly string[] {
  return catalog?.purchaseRoles ?? DEFAULT_PURCHASE_ROLES;
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
  readonly cancelAt: string | null;
};

/** Whether an existing subscription can move to `tier` via the provider's
 *  plan-switch session — pulled out of resolvePlanAction so that function
 *  stays under the guard's complexity budget. A pending cancellation
 *  (`cancelAt` set) must be reactivated via create-portal-session before a
 *  switch is allowed — same gate `switch-plan.write.ts` enforces server-side. */
function canSwitchToTier(
  tier: string,
  subscription: ActiveSubscription,
  plugin: SubscriptionProviderPlugin | null,
): boolean {
  return (
    isSwitchableSubscriptionStatus(subscription.status) &&
    tier !== subscription.tier &&
    subscription.cancelAt === null &&
    plugin?.createPlanSwitchSession !== undefined
  );
}

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
  plugin: SubscriptionProviderPlugin | null,
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

  return canSwitchToTier(tier, subscription, plugin)
    ? BillingPlanActions.switch
    : BillingPlanActions.unavailable;
}

/** `plugin === null` — no provider is registered/resolvable for this
 *  catalog (see checkout-core's `findCatalogProvider`) — collapses onto the
 *  same "enabled: false" result a disabled provider produces, rather than
 *  a separate error shape the panel would need to special-case. */
export async function buildBillingPlans(
  ctx: HandlerContext,
  plugin: SubscriptionProviderPlugin | null,
  catalog: BillingPlanCatalog,
  now: () => Temporal.Instant,
): Promise<BillingPlansResult> {
  const currentTierValue = await catalog.resolveCurrentTier(ctx.db, ctx.user.tenantId);
  const enabled = plugin !== null && (await isPluginBillingEnabled(ctx, plugin));
  const resolvedPrices =
    enabled && plugin
      ? await resolvePlanPrices(ctx, plugin, catalog)
      : new Map<string, ResolvedPlanPrice>(catalog.plans.map((tier) => [tier, null]));

  const subscriptionView = await getSubscriptionForTenant(ctx, ctx.user.tenantId);
  const nowInstant = now();
  const subscription = subscriptionView
    ? {
        status: subscriptionView.status,
        tier: subscriptionView.tier,
        terminal: !isSubscriptionBlockingCheckout(subscriptionView, nowInstant),
        currentPeriodEnd: subscriptionView.currentPeriodEnd.toString(),
        cancelAt: subscriptionView.cancelAt?.toString() ?? null,
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
    currentTier: {
      tier: currentTierValue,
      labelKey: catalog.tierLabelKey(currentTierValue),
      benefits: catalog.benefits(currentTierValue),
    },
    subscription,
    canPurchase,
    plans,
  };
}
