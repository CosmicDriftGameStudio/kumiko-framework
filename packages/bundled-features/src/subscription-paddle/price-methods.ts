// Paddle price lookup for the billing-plans catalog: one batched request for all
// cache misses, cached per price id.

import {
  KNOWN_RECURRING_INTERVALS,
  type ProviderPrice,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import type { PaddleCtxRuntime, PaddlePluginMethod } from "./runtime.ts";

const PRICES_PER_REQUEST = 200;

/** Paddle sends amounts as integer strings in the smallest currency unit. */
export const paddleAmountSchema = z.string().regex(/^-?\d+$/);

const customDataSchema = z.record(z.string(), z.unknown()).nullish();

const paddlePriceSchema = z.object({
  id: z.string().min(1),
  unit_price: z.object({ amount: paddleAmountSchema, currency_code: z.string() }),
  billing_cycle: z.object({ interval: z.string(), frequency: z.number() }).nullable(),
  status: z.string(),
  custom_data: customDataSchema,
  product: z.object({ custom_data: customDataSchema }).nullish(),
});
type PaddlePrice = z.infer<typeof paddlePriceSchema>;

const pricesResponseSchema = z.object({ data: z.array(paddlePriceSchema) });

function stringEntries(
  customData: Readonly<Record<string, unknown>> | null | undefined,
): Array<[string, string]> {
  return Object.entries(customData ?? {}).flatMap(([key, value]): Array<[string, string]> => {
    if (typeof value === "string") return [[key, value]];
    if (typeof value === "number") return [[key, String(value)]];
    return [];
  });
}

// Price custom data wins over the product's.
function metadataOf(price: PaddlePrice): Record<string, string> {
  return Object.fromEntries([
    ...stringEntries(price.product?.custom_data),
    ...stringEntries(price.custom_data),
  ]);
}

function mapPaddlePrice(price: PaddlePrice): ProviderPrice {
  const base = {
    priceId: price.id,
    unitAmount: Number.parseInt(price.unit_price.amount, 10),
    currency: price.unit_price.currency_code.toLowerCase(),
    active: price.status === "active",
    metadata: metadataOf(price),
  };
  const cycle = price.billing_cycle;
  if (!cycle) return { ...base, interval: null, intervalCount: 1 };
  const interval = KNOWN_RECURRING_INTERVALS.find((known) => known === cycle.interval) ?? null;
  return { ...base, interval, intervalCount: interval ? cycle.frequency : null };
}

export type PaddlePriceCache = {
  readonly get: (priceId: string) => ProviderPrice | undefined;
  readonly set: (priceId: string, price: ProviderPrice) => void;
};

export type PaddlePriceCacheOptions = {
  readonly ttlMs?: number;
  readonly now?: () => number;
};

// Keyed by price id alone: ids are unique per account and a cache hit must not
// trigger an audited secret read on every billing-plans render. Failed lookups
// are never cached.
export function createPaddlePriceCache({
  ttlMs = 600_000,
  now = () => Temporal.Now.instant().epochMilliseconds,
}: PaddlePriceCacheOptions = {}): PaddlePriceCache {
  const store = new Map<string, { readonly price: ProviderPrice; readonly expiresAt: number }>();
  return {
    get: (priceId) => {
      const entry = store.get(priceId);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(priceId);
        return undefined;
      }
      return entry.price;
    },
    set: (priceId, price) => {
      store.set(priceId, { price, expiresAt: now() + ttlMs });
    },
  };
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

async function fillPriceCache(
  runtime: PaddleCtxRuntime,
  cache: PaddlePriceCache,
  ctx: HandlerContext,
  priceIds: readonly string[],
): Promise<void> {
  const misses = [...new Set(priceIds.filter((priceId) => cache.get(priceId) === undefined))];
  const settled = await Promise.allSettled(
    chunked(misses, PRICES_PER_REQUEST).map(async (ids) =>
      pricesResponseSchema.parse(
        await runtime.call(ctx, {
          method: "GET",
          path: "/prices",
          query: {
            id: ids.join(","),
            include: "product",
            status: "active,archived",
            per_page: String(PRICES_PER_REQUEST),
          },
        }),
      ),
    ),
  );
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      for (const price of outcome.value.data) cache.set(price.id, mapPaddlePrice(price));
    } else {
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      ctx.obs.log?.warn("subscription-paddle: price lookup failed", { message });
    }
  }
}

export function createPaddleRetrievePrices(
  runtime: PaddleCtxRuntime,
  cache: PaddlePriceCache,
): PaddlePluginMethod<"retrievePrices"> {
  return async (ctx, priceIds) => {
    await fillPriceCache(runtime, cache, ctx, priceIds);
    return priceIds.flatMap((priceId) => cache.get(priceId) ?? []);
  };
}
