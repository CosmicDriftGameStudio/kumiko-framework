// Stripe plugin methods for the POST-tenant-resolution phase:
// createCheckoutSession, createPortalSession, cancelSubscription,
// retrieveSubscription, retrievePrices, and planSwitchSession.
//
// The plugin build (`feature.ts`) registers these as methods on
// `SubscriptionProviderPlugin`. Unlike verifyAndParseWebhook (= pre-tenant),
// they receive the full HandlerContext and resolve the Stripe client from
// the runtime at call time (using the audited api-key from system-secrets),
// rather than from a mount-time closure. Key rotation therefore works
// without a redeploy.
//
// **Type derivation:** method option shapes are derived **directly from the
// plugin contract** (`Parameters<NonNullable
// <SubscriptionProviderPlugin["...method"]>>[1]`). If Foundation extends the
// contract (for example, with a new optional field), the Stripe plugin detects
// it at TypeScript compile time rather than at runtime.

import { createHash } from "node:crypto";
import {
  createTtlPriceCache,
  KNOWN_RECURRING_INTERVALS,
  type ProviderPrice,
  type ProviderSubscriptionSnapshot,
  type RecurringInterval,
  SubscriptionCancelTimings,
  type SubscriptionProviderPlugin,
  type TtlPriceCache,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import Stripe from "stripe";
import type { StripeCtxRuntime } from "./runtime.ts";
import { isResourceMissingStripeError, mapStripeSubscriptionState } from "./verify-webhook.ts";

// Create a Stripe Checkout Session and return its hosted-page URL for the
// app builder to redirect the tenant admin. After checkout, Stripe sends
// `customer.subscription.created` with `metadata.tenantId`; the subsequent
// webhook uses it to resolve the tenant.

export type StripeCheckoutOptions = Parameters<
  NonNullable<SubscriptionProviderPlugin["createCheckoutSession"]>
>[1];

export type StripeCheckoutSessionRuntimeOptions = {
  /** Whether a mode:"payment" checkout gets a Stripe invoice. Default true.
   *  Never applied in mode:"subscription" — Stripe rejects invoice_creation there. */
  readonly paymentInvoiceCreation?: boolean;
};

// Stripe's own Locale union also accepts arbitrary strings, so the known set
// is spelled out here to pick a value Stripe actually renders.
const STRIPE_CHECKOUT_LOCALES = [
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "en-GB",
  "es",
  "es-419",
  "et",
  "fi",
  "fil",
  "fr",
  "fr-CA",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "ms",
  "mt",
  "nb",
  "nl",
  "pl",
  "pt",
  "pt-BR",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "th",
  "tr",
  "vi",
  "zh",
  "zh-HK",
  "zh-TW",
] as const satisfies readonly Stripe.Checkout.SessionCreateParams.Locale[];

// Stripe rejects custom_text.submit.message above 1200 characters.
const STRIPE_CUSTOM_TEXT_MAX_LENGTH = 1200;

export function mapAppLocaleToStripeLocale(
  locale: string,
): Stripe.Checkout.SessionCreateParams.Locale {
  const normalized = locale.replace("_", "-");
  const knownLocales: readonly string[] = STRIPE_CHECKOUT_LOCALES;
  const exact = knownLocales.find((known) => known.toLowerCase() === normalized.toLowerCase());
  if (exact) return exact;
  const language = normalized.split("-")[0]?.toLowerCase();
  return knownLocales.find((known) => known === language) ?? "auto";
}

function isUnknownCustomerStripeError(
  error: unknown,
): error is Stripe.errors.StripeInvalidRequestError {
  return isResourceMissingStripeError(error) && error.param === "customer";
}

export function createStripeCheckoutSession(
  runtime: StripeCtxRuntime,
  { paymentInvoiceCreation = true }: StripeCheckoutSessionRuntimeOptions = {},
) {
  return async (ctx: HandlerContext, options: StripeCheckoutOptions): Promise<{ url: string }> => {
    // Invariant: without billing-live, no Stripe session may be created
    // (sk_test_-keys in production would otherwise create a test-mode checkout).
    // Throw before every Stripe call. The guard used to be provided by the
    // unmounted plugin; Stripe is now always mounted, so the
    // billing-live-config-key gates the write side.
    await runtime.assertBillingLive(ctx);
    const stripe = await runtime.clientForCtx(ctx);
    const mode = options.mode ?? "subscription";
    const metadata = {
      tenantId: options.tenantId,
      ...(options.consentId && { consentId: options.consentId }),
    };

    const sessionParams = (
      providerCustomerId: string | undefined,
    ): Stripe.Checkout.SessionCreateParams => ({
      mode,
      line_items: [{ price: options.priceId, quantity: 1 }],
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
      submit_type: "pay",
      ...(options.locale && { locale: mapAppLocaleToStripeLocale(options.locale) }),
      ...(options.submitMessage && {
        custom_text: {
          submit: { message: options.submitMessage.slice(0, STRIPE_CUSTOM_TEXT_MAX_LENGTH) },
        },
      }),
      // subscription_data is subscription-mode-only (Stripe rejects it in
      // payment-mode) — the subsequent webhook reads metadata.tenantId off
      // the subscription it creates. payment-mode has no subscription, so
      // tenantId travels via payment_intent_data.metadata instead.
      // invoice_creation is payment-mode-only for the same reason — Stripe
      // rejects it in subscription-mode, which invoices via the subscription
      // itself.
      ...(mode === "subscription"
        ? { subscription_data: { metadata } }
        : {
            payment_intent_data: { metadata },
            invoice_creation: { enabled: paymentInvoiceCreation },
            // Without a customer, Stripe's default "if_required" makes a guest
            // checkout when invoice_creation is off; the webhook then has no
            // customer id and drops the paid payment as ignored.
            ...(!providerCustomerId && { customer_creation: "always" as const }),
          }),
      ...(providerCustomerId && { customer: providerCustomerId }),
    });

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(sessionParams(options.providerCustomerId));
    } catch (error) {
      if (!options.providerCustomerId || !isUnknownCustomerStripeError(error)) throw error;
      // Stripe account switch (test -> live) or a customer deleted in the dashboard leaves a
      // stored customer id Stripe no longer knows; checkout creates a fresh customer instead.
      ctx.obs.log?.warn(
        "subscription-stripe: stored customer unknown to Stripe, retrying without it",
      );
      session = await stripe.checkout.sessions.create(sessionParams(undefined));
    }

    if (!session.url) {
      // Defensive: Stripe returns a hosted url for both modes today —
      // guards against future API drift.
      throw new Error("subscription-stripe: checkout.sessions.create returned no url");
    }
    return { url: session.url };
  };
}

// =============================================================================
// createPortalSession
// =============================================================================
//
// Stripe Customer-Portal-Session — Tenant verwaltet seine subscription
// selbst (cancel, payment-method, invoice-history).

export type StripePortalOptions = Parameters<
  NonNullable<SubscriptionProviderPlugin["createPortalSession"]>
>[1];

export function createStripePortalSession(runtime: StripeCtxRuntime) {
  return async (ctx: HandlerContext, options: StripePortalOptions): Promise<{ url: string }> => {
    const stripe = await runtime.clientForCtx(ctx);
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: options.providerCustomerId,
        return_url: options.returnUrl,
      });
      return { url: session.url };
    } catch (error) {
      // A portal needs an existing customer, so unlike checkout there is no retry without one.
      if (!isUnknownCustomerStripeError(error)) throw error;
      throw new UnprocessableError("provider_customer_unknown", {
        i18nKey: "billing-foundation.errors.providerCustomerUnknown",
        message: `subscription-stripe: Stripe does not know customer "${options.providerCustomerId}" (account switch or customer deleted).`,
        cause: error,
      });
    }
  };
}

// =============================================================================
// resumeSubscription
// =============================================================================
//
// Takes back a period-end cancel; the following `customer.subscription.updated`
// carries cancel_at null, which the projection stores as "renews".

export function createStripeResumeSubscription(runtime: StripeCtxRuntime) {
  return async (
    ctx: HandlerContext,
    options: { readonly providerSubscriptionId: string },
  ): Promise<void> => {
    const stripe = await runtime.clientForCtx(ctx);
    await stripe.subscriptions.update(options.providerSubscriptionId, {
      cancel_at_period_end: false,
    });
  };
}

// =============================================================================
// cancelSubscription
// =============================================================================
//
// Stripe sends `customer.subscription.updated` (period-end) or
// `customer.subscription.deleted` (immediately) afterwards — the state
// update runs through the normal webhook path. This only triggers the API call.

export type StripeCancelOptions = Parameters<
  NonNullable<SubscriptionProviderPlugin["cancelSubscription"]>
>[1];

export function createStripeCancelSubscription(runtime: StripeCtxRuntime) {
  return async (ctx: HandlerContext, options: StripeCancelOptions): Promise<void> => {
    const stripe = await runtime.clientForCtx(ctx);
    if (options.when === SubscriptionCancelTimings.periodEnd) {
      await stripe.subscriptions.update(options.providerSubscriptionId, {
        cancel_at_period_end: true,
      });
    } else {
      await stripe.subscriptions.cancel(options.providerSubscriptionId);
    }
  };
}

// =============================================================================
// retrieveSubscription — live provider-side snapshot for the
// sync-subscriptions backfill job
// =============================================================================
//
// Same status/tier/period-end/cancel_at mapping as verify-webhook.ts, via
// the shared mapStripeSubscriptionState — the sync path and the webhook path
// must never disagree on what a given Stripe subscription object means.

export type StripeRetrieveSubscriptionOptions = {
  readonly priceToTier: Readonly<Record<string, string>>;
};

export function createStripeRetrieveSubscription(
  runtime: StripeCtxRuntime,
  { priceToTier }: StripeRetrieveSubscriptionOptions,
) {
  return async (
    ctx: HandlerContext,
    providerSubscriptionId: string,
  ): Promise<ProviderSubscriptionSnapshot | null> => {
    const stripe = await runtime.clientForCtx(ctx);
    let subscription: Stripe.Subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(providerSubscriptionId);
    } catch (error) {
      if (isResourceMissingStripeError(error)) return null;
      throw error;
    }

    const state = mapStripeSubscriptionState(subscription, priceToTier);
    if (!state) return null;

    return {
      providerCustomerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      providerSubscriptionId: subscription.id,
      ...state,
    };
  };
}

// =============================================================================
// retrievePrices — bulk price lookup for the billing-plans catalog
// =============================================================================

// stripe >= 22.5 widened Recurring.Interval to an open union; an interval Stripe adds later narrows to null here instead of widening ProviderPrice.
function isKnownRecurringInterval(interval: string | undefined): interval is RecurringInterval {
  return KNOWN_RECURRING_INTERVALS.some((known) => known === interval);
}

function mapStripePrice(price: Stripe.Price): ProviderPrice {
  const interval = price.recurring?.interval;
  const knownInterval = isKnownRecurringInterval(interval) ? interval : null;
  return {
    priceId: price.id,
    unitAmount: price.unit_amount,
    currency: price.currency,
    interval: knownInterval,
    // Kept consistent with `interval`: a count without an interval would read as a half-recurring price.
    intervalCount: knownInterval ? (price.recurring?.interval_count ?? null) : null,
    active: price.active,
    metadata: price.metadata ?? {},
  };
}

// A cache-hit skips clientForCtx entirely — no audited secret-read fires for
// requests the billing-plans catalog re-renders on every page load. Keyed by
// priceId alone: Stripe priceIds are account-wide unique. Failed lookups are
// never cached, so a transient Stripe outage self-heals on the next call.
export type StripePriceCache = TtlPriceCache<Stripe.Price>;

export type StripePriceCacheOptions = {
  readonly ttlMs?: number;
  readonly now?: () => number;
};

export function createStripePriceCache({
  ttlMs,
  now = () => Date.now(),
}: StripePriceCacheOptions = {}): StripePriceCache {
  return createTtlPriceCache<Stripe.Price>({ ttlMs, now });
}

/** Fills `cache` for every priceId not already resolved — the only place
 *  that ever calls `stripe.prices.retrieve`, shared by retrievePrices and
 *  createPlanSwitchSession so both benefit from the same TTL cache. */
async function resolvePricesViaCache(
  runtime: StripeCtxRuntime,
  cache: StripePriceCache,
  ctx: HandlerContext,
  priceIds: readonly string[],
): Promise<void> {
  const misses = priceIds.filter((priceId) => cache.get(priceId) === undefined);
  // skip: every price is already cached, nothing to retrieve.
  if (misses.length === 0) return;
  const stripe = await runtime.clientForCtx(ctx);
  const settled = await Promise.allSettled(
    misses.map(async (priceId) => ({ priceId, price: await stripe.prices.retrieve(priceId) })),
  );
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      cache.set(outcome.value.priceId, outcome.value.price);
    } else {
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      ctx.obs.log?.warn("subscription-stripe: prices.retrieve failed", { message });
    }
  }
}

export function createStripeRetrievePrices(runtime: StripeCtxRuntime, cache: StripePriceCache) {
  const warnedUnknownIntervalPriceIds = new Set<string>();
  return async (
    ctx: HandlerContext,
    priceIds: readonly string[],
  ): Promise<readonly ProviderPrice[]> => {
    await resolvePricesViaCache(runtime, cache, ctx, priceIds);
    return priceIds.flatMap((priceId) => {
      const price = cache.get(priceId);
      if (!price) return [];
      const mapped = mapStripePrice(price);
      const rawInterval = price.recurring?.interval;
      if (rawInterval && mapped.interval === null && !warnedUnknownIntervalPriceIds.has(priceId)) {
        warnedUnknownIntervalPriceIds.add(priceId);
        ctx.obs.log?.warn("subscription-stripe: price has an unknown recurring interval", {
          priceId,
          interval: rawInterval,
        });
      }
      return [mapped];
    });
  };
}

// =============================================================================
// createPlanSwitchSession — Customer-Portal subscription_update_confirm flow
// =============================================================================
//
// Stripe's Customer Portal enforces at most one price per product per
// billing-portal *configuration* under `features.subscription_update.
// products[].prices` — two allowed prices that share both product and
// interval would silently collide (only one survives). This plugin instead
// fails fast at switch-time so a catalog misconfiguration surfaces
// immediately rather than as a customer picking a price that quietly does
// nothing in the portal.
//
// Configurations are content-addressed: the sorted, comma-joined
// allowed-price-id list is both the in-process cache key and the
// configuration's own `metadata.priceSetHash` (checked via `list()` before
// creating), so concurrent switch-plan calls across process restarts reuse
// one Stripe-side configuration per distinct catalog price-set instead of
// creating a new one per request — Stripe has no "find configuration by
// price-set" lookup of its own.

// In-process cache from priceSetHash → Stripe configuration id, one per
// factory mount (constructed in feature.ts and threaded through exactly
// like priceCache) rather than module-global — a module-global cache would
// leak state across independent test runs and across two mounts of this
// factory in the same process. Configurations are looked up by content-
// addressed hash via `list()` first, so a process restart or a second
// in-flight call still converges on one Stripe-side configuration per
// distinct catalog price-set instead of creating a new one per request.
export type PortalConfigurationCache = Map<string, string>;
const PLAN_SWITCH_METADATA_KEY = "kumikoPlanSwitch";

function resolveProductId(product: string | Stripe.Product | Stripe.DeletedProduct): string {
  return typeof product === "string" ? product : product.id;
}

/** Both our own pre-Stripe-call product+interval collision check and a live
 *  `StripeInvalidRequestError` from `configurations.create()`
 *  surface the same underlying misconfiguration (two plan tiers sharing one
 *  Stripe product) — mapped to the same `UnprocessableError` so the panel
 *  only needs one i18nKey to translate. */
function planTiersShareProductError(cause: unknown): UnprocessableError {
  return new UnprocessableError("plan_tiers_share_product", {
    i18nKey: "billing-foundation.errors.planTiersShareProduct",
    message:
      "subscription-stripe: the Stripe Customer Portal rejected this configuration — every plan tier needs its own Stripe product.",
    ...(cause instanceof Error && { cause }),
  });
}

/** Stripe rejects a portal-configuration whose `subscription_update.products`
 *  entries collide (e.g. two prices for one product) with a
 *  `StripeInvalidRequestError` — matched defensively on both `param` and
 *  `message` since Stripe doesn't document a stable machine-readable code
 *  for this case. */
function isPlanTiersShareProductStripeError(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) return false;
  return (
    (typeof error.param === "string" && error.param.includes("subscription_update")) ||
    error.message.includes("subscription_update")
  );
}

function priceSetHash(prices: readonly Stripe.Price[]): string {
  const productPricePairs = prices
    .map((price) => `${resolveProductId(price.product)}:${price.id}`)
    .sort();
  return createHash("sha256").update(productPricePairs.join(",")).digest("hex").slice(0, 16);
}

/** Auto-paginates `configurations.list()` — a tenant with more than one page
 *  of active portal configurations (100+, Stripe's max page size) would
 *  otherwise miss a matching hash on later pages and create a duplicate
 *  configuration. Manual `starting_after` paging (rather than `for await`
 *  over the SDK's async-iterable list response) keeps this callable with a
 *  plain `{ data, has_more }` mock in unit tests. */
async function listActivePortalConfigurations(
  stripe: Stripe,
): Promise<readonly Stripe.BillingPortal.Configuration[]> {
  const configurations: Stripe.BillingPortal.Configuration[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.billingPortal.configurations.list({
      active: true,
      limit: 100,
      ...(startingAfter !== undefined && { starting_after: startingAfter }),
    });
    configurations.push(...page.data);
    if (!page.has_more) break;
    const last = page.data.at(-1);
    if (!last) break;
    startingAfter = last.id;
  }
  return configurations;
}

async function resolvePortalConfiguration(
  stripe: Stripe,
  runtime: StripeCtxRuntime,
  cache: StripePriceCache,
  portalConfigCache: PortalConfigurationCache,
  ctx: HandlerContext,
  allowedPriceIds: readonly string[],
): Promise<{ readonly id: string; readonly hash: string }> {
  await resolvePricesViaCache(runtime, cache, ctx, allowedPriceIds);
  const prices = allowedPriceIds.flatMap((priceId) => {
    const price = cache.get(priceId);
    return price ? [price] : [];
  });
  // A transient prices.retrieve failure would otherwise yield a different
  // priceSetHash and persist an incomplete portal configuration at Stripe.
  if (prices.length !== allowedPriceIds.length) {
    throw new UnprocessableError("price_unavailable", {
      i18nKey: "billing-foundation.errors.priceUnavailable",
    });
  }

  const hash = priceSetHash(prices);
  const cached = portalConfigCache.get(hash);
  if (cached) return { id: cached, hash };

  const pricesByProduct = new Map<string, string[]>();
  const seenProductInterval = new Set<string>();
  for (const price of prices) {
    const productId = resolveProductId(price.product);
    const interval = price.recurring?.interval ?? "one_time";
    const productIntervalKey = `${productId}:${interval}`;
    if (seenProductInterval.has(productIntervalKey)) {
      throw new UnprocessableError("plan_tiers_share_product", {
        i18nKey: "billing-foundation.errors.planTiersShareProduct",
        message: `subscription-stripe: switch-plan's allowed prices include two prices for product "${productId}" at interval "${interval}" — the Stripe Customer Portal only supports one price per product per interval in a single configuration; every plan tier needs its own Stripe product.`,
      });
    }
    seenProductInterval.add(productIntervalKey);
    const existing = pricesByProduct.get(productId);
    if (existing) {
      existing.push(price.id);
    } else {
      pricesByProduct.set(productId, [price.id]);
    }
  }

  const existingConfigurations = await listActivePortalConfigurations(stripe);
  const found = existingConfigurations.find(
    (configuration) => configuration.metadata?.[PLAN_SWITCH_METADATA_KEY] === hash,
  );
  if (found) {
    portalConfigCache.set(hash, found.id);
    return { id: found.id, hash };
  }

  let created: Stripe.BillingPortal.Configuration;
  try {
    created = await stripe.billingPortal.configurations.create({
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price"],
          proration_behavior: "create_prorations",
          products: [...pricesByProduct.entries()].map(([product, prices2]) => ({
            product,
            prices: prices2,
          })),
        },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
      },
      metadata: { [PLAN_SWITCH_METADATA_KEY]: hash },
    });
  } catch (error) {
    if (isPlanTiersShareProductStripeError(error)) throw planTiersShareProductError(error);
    throw error;
  }
  portalConfigCache.set(hash, created.id);
  return { id: created.id, hash };
}

export type StripePlanSwitchOptions = Parameters<
  NonNullable<SubscriptionProviderPlugin["createPlanSwitchSession"]>
>[1];

export function createStripePlanSwitchSession(
  runtime: StripeCtxRuntime,
  cache: StripePriceCache,
  portalConfigCache: PortalConfigurationCache,
) {
  return async (
    ctx: HandlerContext,
    options: StripePlanSwitchOptions,
  ): Promise<{ url: string }> => {
    await runtime.assertBillingLive(ctx, "switch-plan");
    const stripe = await runtime.clientForCtx(ctx);

    const subscription = await stripe.subscriptions.retrieve(options.providerSubscriptionId);
    const items = subscription.items.data;
    if (items.length !== 1) {
      throw new Error(
        `subscription-stripe: subscription "${options.providerSubscriptionId}" must have exactly one line item to switch (has ${items.length}).`,
      );
    }
    const item = items[0];
    if (!item) {
      throw new Error(
        `subscription-stripe: subscription "${options.providerSubscriptionId}" has no line items to switch.`,
      );
    }
    if (item.price.id === options.targetPriceId) {
      throw new ConflictError({
        i18nKey: "billing-foundation.errors.alreadyOnPlan",
        message: `subscription-stripe: subscription "${options.providerSubscriptionId}" is already on price "${options.targetPriceId}".`,
      });
    }
    if (!options.allowedPriceIds.includes(options.targetPriceId)) {
      throw new Error(
        `subscription-stripe: target price "${options.targetPriceId}" is not one of the catalog's allowed prices.`,
      );
    }

    const { id: configurationId, hash } = await resolvePortalConfiguration(
      stripe,
      runtime,
      cache,
      portalConfigCache,
      ctx,
      options.allowedPriceIds,
    );
    const customerId =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        configuration: configurationId,
        flow_data: {
          type: "subscription_update_confirm",
          subscription_update_confirm: {
            subscription: options.providerSubscriptionId,
            items: [{ id: item.id, price: options.targetPriceId, quantity: item.quantity ?? 1 }],
          },
          after_completion: { type: "redirect", redirect: { return_url: options.returnUrl } },
        },
      });
      return { url: session.url };
    } catch (error) {
      // A cached configuration id that Stripe now rejects (deleted/archived
      // out-of-band) must not poison every subsequent switch for the same
      // price-set — evict it so the next call re-searches/re-creates.
      portalConfigCache.delete(hash);
      // Not mapped to plan_tiers_share_product: a sessions.create error under
      // flow_data.subscription_update_confirm.* is a different problem (inactive
      // target price, wrong item) and mapping it would hide the real cause.
      throw error;
    }
  };
}
