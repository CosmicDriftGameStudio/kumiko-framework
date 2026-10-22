// Dodo Payments plugin methods for the post-tenant phase. Option shapes are
// derived from the plugin contract so a contract change fails at compile time.
// Every response is validated with Zod; every non-2xx throws a DodoHttpError.

import {
  KNOWN_RECURRING_INTERVALS,
  type PlanSwitchPreview,
  type ProviderPrice,
  type ProviderSubscriptionSnapshot,
  SubscriptionCancelTimings,
  type SubscriptionProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { DodoHttpError } from "./client.ts";
import type { DodoCtxRuntime } from "./runtime.ts";
import { dodoSubscriptionSchema, mapDodoSubscriptionState } from "./verify-webhook.ts";

type PluginMethod<TName extends keyof SubscriptionProviderPlugin> = NonNullable<
  SubscriptionProviderPlugin[TName]
>;

const NOT_FOUND = 404;

function subscriptionPath(providerSubscriptionId: string): string {
  return `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`;
}

function forcedLanguage(locale: string): string {
  return (locale.split(/[-_]/)[0] ?? locale).toLowerCase();
}

// =============================================================================
// Checkout + portal + cancel/resume
// =============================================================================

const checkoutResponseSchema = z.object({
  session_id: z.string(),
  checkout_url: z.string().nullable(),
});

export function createDodoCheckoutSession(
  runtime: DodoCtxRuntime,
): PluginMethod<"createCheckoutSession"> {
  return async (ctx, options) => {
    // No Dodo session may be created while billing is not live.
    await runtime.assertBillingLive(ctx);
    const response = checkoutResponseSchema.parse(
      await runtime.call(ctx, {
        method: "POST",
        path: "/checkouts",
        body: {
          product_cart: [{ product_id: options.priceId, quantity: 1 }],
          ...(options.providerCustomerId && {
            customer: { customer_id: options.providerCustomerId },
          }),
          return_url: options.successUrl,
          cancel_url: options.cancelUrl,
          metadata: {
            tenantId: options.tenantId,
            ...(options.consentId && { consentId: options.consentId }),
          },
          ...(options.locale && {
            customization: { force_language: forcedLanguage(options.locale) },
          }),
        },
      }),
    );
    if (!response.checkout_url) {
      throw new Error("subscription-dodo: checkout session was created without a checkout_url");
    }
    return { url: response.checkout_url };
  };
}

const portalResponseSchema = z.object({ link: z.string() });

export function createDodoPortalSession(
  runtime: DodoCtxRuntime,
): PluginMethod<"createPortalSession"> {
  return async (ctx, options) => {
    const response = portalResponseSchema.parse(
      await runtime.call(ctx, {
        method: "POST",
        path: `/customers/${encodeURIComponent(options.providerCustomerId)}/customer-portal/session`,
        query: { return_url: options.returnUrl },
      }),
    );
    return { url: response.link };
  };
}

export function createDodoCancelSubscription(
  runtime: DodoCtxRuntime,
): PluginMethod<"cancelSubscription"> {
  return async (ctx, options) => {
    await runtime.call(ctx, {
      method: "PATCH",
      path: subscriptionPath(options.providerSubscriptionId),
      body:
        options.when === SubscriptionCancelTimings.periodEnd
          ? { cancel_at_next_billing_date: true }
          : { status: "cancelled" },
    });
  };
}

export function createDodoResumeSubscription(
  runtime: DodoCtxRuntime,
): PluginMethod<"resumeSubscription"> {
  return async (ctx, options) => {
    await runtime.call(ctx, {
      method: "PATCH",
      path: subscriptionPath(options.providerSubscriptionId),
      body: { cancel_at_next_billing_date: false },
    });
  };
}

// =============================================================================
// Prices
// =============================================================================

const productSchema = z.object({
  product_id: z.string(),
  price: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("recurring_price"),
      price: z.number(),
      currency: z.string(),
      payment_frequency_interval: z.string(),
      payment_frequency_count: z.number(),
    }),
    z.object({
      type: z.literal("one_time_price"),
      price: z.number(),
      currency: z.string(),
    }),
    z.object({ type: z.literal("usage_based_price") }),
  ]),
});
type DodoProduct = z.infer<typeof productSchema>;

function mapDodoProduct(product: DodoProduct): ProviderPrice | null {
  const { price } = product;
  if (price.type === "usage_based_price") return null;
  const base = {
    priceId: product.product_id,
    unitAmount: price.price,
    currency: price.currency.toLowerCase(),
    active: true,
    metadata: {},
  };
  if (price.type === "one_time_price") return { ...base, interval: null, intervalCount: 1 };
  const rawInterval = price.payment_frequency_interval.toLowerCase();
  const interval = KNOWN_RECURRING_INTERVALS.find((known) => known === rawInterval) ?? null;
  return {
    ...base,
    interval,
    intervalCount: interval ? price.payment_frequency_count : null,
  };
}

export type DodoPriceCache = {
  readonly get: (priceId: string) => ProviderPrice | null | undefined;
  readonly set: (priceId: string, price: ProviderPrice | null) => void;
};

export type DodoPriceCacheOptions = {
  readonly ttlMs?: number;
  readonly now?: () => number;
};

// Keyed by product id alone: ids are unique per account and a cache hit must not
// trigger an audited secret read on every billing-plans render. Failed lookups
// are never cached. `null` is a cached "skipped" product (usage-based).
export function createDodoPriceCache({
  ttlMs = 600_000,
  now = () => Temporal.Now.instant().epochMilliseconds,
}: DodoPriceCacheOptions = {}): DodoPriceCache {
  const store = new Map<
    string,
    { readonly price: ProviderPrice | null; readonly expiresAt: number }
  >();
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

async function fillPriceCache(
  runtime: DodoCtxRuntime,
  cache: DodoPriceCache,
  ctx: HandlerContext,
  priceIds: readonly string[],
): Promise<void> {
  const misses = priceIds.filter((priceId) => cache.get(priceId) === undefined);
  const settled = await Promise.allSettled(
    misses.map(async (priceId) => ({
      priceId,
      product: productSchema.parse(
        await runtime.call(ctx, {
          method: "GET",
          path: `/products/${encodeURIComponent(priceId)}`,
        }),
      ),
    })),
  );
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      cache.set(outcome.value.priceId, mapDodoProduct(outcome.value.product));
    } else {
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      ctx.log?.warn("subscription-dodo: product lookup failed", { message });
    }
  }
}

export function createDodoRetrievePrices(
  runtime: DodoCtxRuntime,
  cache: DodoPriceCache,
): PluginMethod<"retrievePrices"> {
  return async (ctx, priceIds) => {
    await fillPriceCache(runtime, cache, ctx, priceIds);
    return priceIds.flatMap((priceId) => cache.get(priceId) ?? []);
  };
}

// =============================================================================
// Plan switch (in-app: preview + apply)
// =============================================================================

const previewResponseSchema = z.object({
  immediate_charge: z.object({
    summary: z.object({
      total_amount: z.number(),
      tax: z.number().nullable(),
      currency: z.string(),
      customer_credits: z.number(),
    }),
    effective_at: z.string(),
  }),
});

function changePlanBody(targetPriceId: string) {
  return {
    product_id: targetPriceId,
    quantity: 1,
    proration_billing_mode: "prorated_immediately",
    effective_at: "immediately",
  };
}

export function createDodoPreviewPlanSwitch(
  runtime: DodoCtxRuntime,
): PluginMethod<"previewPlanSwitch"> {
  return async (ctx, options): Promise<PlanSwitchPreview> => {
    const { immediate_charge: charge } = previewResponseSchema.parse(
      await runtime.call(ctx, {
        method: "POST",
        path: `${subscriptionPath(options.providerSubscriptionId)}/change-plan/preview`,
        body: changePlanBody(options.targetPriceId),
      }),
    );
    return {
      amountDueNow: charge.summary.total_amount,
      tax: charge.summary.tax,
      currency: charge.summary.currency.toLowerCase(),
      credit: charge.summary.customer_credits,
      effectiveAt: charge.effective_at,
    };
  };
}

const applyResponseSchema = z.looseObject({
  payment_id: z.string().nullish(),
  payment_link: z.string().nullish(),
});

// The switch itself arrives later as a subscription.plan_changed webhook;
// prevent_change keeps the old plan if the immediate charge fails.
export function createDodoApplyPlanSwitch(
  runtime: DodoCtxRuntime,
): PluginMethod<"applyPlanSwitch"> {
  return async (ctx, options) => {
    applyResponseSchema.parse(
      await runtime.call(ctx, {
        method: "POST",
        path: `${subscriptionPath(options.providerSubscriptionId)}/change-plan`,
        body: {
          ...changePlanBody(options.targetPriceId),
          on_payment_failure: "prevent_change",
          metadata: {
            tenantId: options.tenantId,
            ...(options.consentId && { consentId: options.consentId }),
          },
        },
      }),
    );
  };
}

// =============================================================================
// retrieveSubscription
// =============================================================================

export function createDodoRetrieveSubscription(
  runtime: DodoCtxRuntime,
  options: { readonly priceToTier: Readonly<Record<string, string>> },
): PluginMethod<"retrieveSubscription"> {
  return async (ctx, providerSubscriptionId): Promise<ProviderSubscriptionSnapshot | null> => {
    let raw: unknown;
    try {
      raw = await runtime.call(ctx, {
        method: "GET",
        path: subscriptionPath(providerSubscriptionId),
      });
    } catch (error) {
      if (error instanceof DodoHttpError && error.status === NOT_FOUND) return null;
      throw error;
    }
    const sub = dodoSubscriptionSchema.parse(raw);
    const state = mapDodoSubscriptionState(sub, options.priceToTier);
    if (!state) return null;
    return {
      providerCustomerId: sub.customer.customer_id,
      providerSubscriptionId: sub.subscription_id,
      ...state,
    };
  };
}
