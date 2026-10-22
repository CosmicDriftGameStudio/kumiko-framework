import type { BillingPlanView } from "../types.ts";

type Recurrence = {
  readonly interval: string | null;
  readonly intervalCount: number | null;
};

export function intervalKey(price: Recurrence | null): string | undefined {
  if (price === null || price.interval === null) return undefined;
  return price.intervalCount !== null && price.intervalCount > 1
    ? `billing-foundation.plans.everyInterval.${price.interval}`
    : `billing-foundation.plans.perInterval.${price.interval}`;
}

export function renewalKey(price: Recurrence | null): string | undefined {
  if (price === null || price.interval === null) return undefined;
  return price.intervalCount !== null && price.intervalCount > 1
    ? `billing-foundation.consent.renewsEvery.${price.interval}`
    : `billing-foundation.consent.renews.${price.interval}`;
}

type PlanPrice = NonNullable<BillingPlanView["price"]>;

export function pricesDiffer(prices: readonly PlanPrice[]): boolean {
  const [first, ...rest] = prices;
  return (
    first !== undefined &&
    rest.some(
      (price) =>
        price.unitAmount !== first.unitAmount ||
        price.currency !== first.currency ||
        price.interval !== first.interval ||
        price.intervalCount !== first.intervalCount,
    )
  );
}

/** Price of `tier` at every provider that offers it, in provider order. */
export function tierPrices(
  providers: readonly { readonly plans: readonly BillingPlanView[] }[],
  tier: string,
): PlanPrice[] {
  return providers.flatMap((provider) => {
    const price = provider.plans.find((plan) => plan.tier === tier)?.price;
    return price ? [price] : [];
  });
}

export function cheapestPrice(prices: readonly PlanPrice[]): PlanPrice | undefined {
  return prices.reduce<PlanPrice | undefined>(
    (lowest, price) =>
      lowest === undefined || price.unitAmount < lowest.unitAmount ? price : lowest,
    undefined,
  );
}
