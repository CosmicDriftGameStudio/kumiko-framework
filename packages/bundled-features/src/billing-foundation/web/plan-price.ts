import type { BillingPlanView } from "../types.ts";

type Recurrence = {
  readonly interval: string | null;
  readonly intervalCount: number | null;
};

function recurrenceKey(
  price: Recurrence | null,
  everyPrefix: string,
  singlePrefix: string,
): string | undefined {
  if (price === null || price.interval === null) return undefined;
  return price.intervalCount !== null && price.intervalCount > 1
    ? `${everyPrefix}.${price.interval}`
    : `${singlePrefix}.${price.interval}`;
}

export function intervalKey(price: Recurrence | null): string | undefined {
  return recurrenceKey(
    price,
    "billing-foundation.plans.everyInterval",
    "billing-foundation.plans.perInterval",
  );
}

export function renewalKey(price: Recurrence | null): string | undefined {
  return recurrenceKey(
    price,
    "billing-foundation.consent.renewsEvery",
    "billing-foundation.consent.renews",
  );
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
