// Shared checkout plumbing for create-checkout-session, start-plan-checkout
// and switch-plan — provider/catalog resolution, redirect-origin hardening,
// and the price/subscription-state gate that turns a bare priceId-driven
// checkout into a plan-aware one. Internal — not re-exported from index.ts.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  UnconfiguredError,
  UnprocessableError,
} from "@cosmicdrift/kumiko-framework/errors";
import { isTerminalSubscriptionStatus, SUBSCRIPTION_PROVIDER_EXTENSION } from "./constants";
import { getSubscriptionForTenant } from "./get-subscription-for-tenant";
import type { BillingPlanCatalog, SubscriptionProviderPlugin } from "./types";

/** Narrows a `readonly string[]` to the non-empty tuple shape `z.enum`
 *  needs. Callers only reach this with a catalog's `plans` — the feature
 *  factory already rejected an empty `plans` array at mount time, so the
 *  `false` branch is unreachable there; kept as a real type guard (not a
 *  cast) so a future caller without that guarantee fails loudly instead of
 *  producing a `z.enum([])`. */
export function isNonEmptyStringArray(
  arr: readonly string[],
): arr is readonly [string, ...string[]] {
  return arr.length > 0;
}

export type ResolvedProvider = {
  readonly name: string;
  readonly plugin: SubscriptionProviderPlugin;
};

export function resolveProviderPlugin(ctx: HandlerContext, providerName: string): ResolvedProvider {
  const usages = ctx.registry.getExtensionUsages(SUBSCRIPTION_PROVIDER_EXTENSION);
  const usage = usages.find((u) => u.entityName === providerName);
  if (!usage) {
    const known = usages.map((u) => u.entityName).join(", ") || "<none>";
    throw new Error(
      `subscription-foundation: provider "${providerName}" not registered. Known: ${known}.`,
    );
  }
  // @cast-boundary engine-payload — extension-usage carries unknown options
  return { name: providerName, plugin: usage.options as SubscriptionProviderPlugin };
}

/** Picks the catalog's provider — an explicit `catalog.providerName`, or the
 *  single registered provider exposing `priceToTier` when there is exactly
 *  one. Throws `UnconfiguredError` otherwise (none, or an ambiguous choice
 *  between several). */
export function resolveCatalogProvider(
  ctx: HandlerContext,
  catalog: BillingPlanCatalog,
): ResolvedProvider {
  if (catalog.providerName) {
    return resolveProviderPlugin(ctx, catalog.providerName);
  }
  const usages = ctx.registry.getExtensionUsages(SUBSCRIPTION_PROVIDER_EXTENSION);
  const withPriceCatalog = usages.filter(
    (u) => (u.options as SubscriptionProviderPlugin).priceToTier !== undefined,
  );
  if (withPriceCatalog.length !== 1) {
    throw new UnconfiguredError({
      feature: "billing-foundation",
      key: "catalog.providerName",
      hint:
        withPriceCatalog.length === 0
          ? "no registered subscriptionProvider plugin exposes priceToTier"
          : `ambiguous — ${withPriceCatalog.length} registered plugins expose priceToTier, set catalog.providerName explicitly`,
    });
  }
  const usage = withPriceCatalog[0];
  if (!usage) {
    throw new UnconfiguredError({ feature: "billing-foundation", key: "catalog.providerName" });
  }
  // @cast-boundary engine-payload — extension-usage carries unknown options
  return { name: usage.entityName, plugin: usage.options as SubscriptionProviderPlugin };
}

/** Every redirect URL a checkout/portal call carries must share the origin
 *  of the configured `baseUrl` — otherwise a caller could redirect a tenant
 *  admin's browser (with a fresh Stripe session cookie) to an attacker-
 *  controlled origin after checkout. Pure — no ctx, unit-testable. */
export function assertRedirectOrigins(urls: readonly string[], baseUrl: string | undefined): void {
  if (baseUrl === undefined) {
    throw new UnconfiguredError({
      feature: "billing-foundation",
      key: "baseUrl",
      hint: "pass createBillingFoundationFeature({ baseUrl })",
    });
  }
  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(baseUrl).origin;
  } catch {
    throw new UnconfiguredError({
      feature: "billing-foundation",
      key: "baseUrl",
      hint: `"${baseUrl}" is not a parseable absolute URL`,
    });
  }
  for (const url of urls) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new UnprocessableError("redirect_origin_not_allowed", {
        i18nKey: "billing-foundation.errors.redirectOriginNotAllowed",
        message: `"${url}" is not a parseable absolute URL`,
      });
    }
    if (origin !== allowedOrigin) {
      throw new UnprocessableError("redirect_origin_not_allowed", {
        i18nKey: "billing-foundation.errors.redirectOriginNotAllowed",
        message: `redirect url "${url}" has origin "${origin}", expected "${allowedOrigin}"`,
      });
    }
  }
}

/** Strips a single trailing "/" — a configured `baseUrl` and a plan path
 *  both carrying a slash would otherwise concatenate into a protocol-
 *  relative "//path". */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

/** Builds an absolute plan-checkout/portal URL by concatenating a
 *  normalized `baseUrl` with `path` — per `BillingFoundationOptions.baseUrl`'s
 *  own doc comment this is string-concatenation on purpose (not
 *  `new URL(path, baseUrl)`, which would drop a path prefix); normalizing
 *  first stops a trailing "/" on `baseUrl` from producing "//path". */
export function joinBaseUrl(baseUrl: string, path: string): string {
  return normalizeBaseUrl(baseUrl) + path;
}

/** Shared "no non-terminal subscription yet" gate for `openCheckout`'s
 *  mode:"subscription" branch and start-plan-checkout — both need the exact
 *  same ConflictError so a bare-priceId caller and a catalog caller can't
 *  diverge in wording. Returns the existing subscription (or null) so a
 *  caller that needs it afterwards (start-plan-checkout's providerCustomerId
 *  reuse) doesn't have to look it up twice. */
export async function assertNoActiveSubscription(
  ctx: HandlerContext,
): Promise<Awaited<ReturnType<typeof getSubscriptionForTenant>>> {
  const existing = await getSubscriptionForTenant(ctx, ctx.user.tenantId);
  if (existing && !isTerminalSubscriptionStatus(existing.status)) {
    throw new ConflictError({
      i18nKey: "billing-foundation.errors.subscriptionExists",
      message:
        "tenant already has a non-terminal subscription; use billing-foundation:write:switch-plan",
    });
  }
  return existing;
}

export type OpenCheckoutOptions = {
  readonly baseUrl?: string;
  readonly catalog?: BillingPlanCatalog;
};

export type OpenCheckoutInput = {
  readonly providerName: string;
  readonly priceId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly providerCustomerId?: string;
  readonly mode?: "subscription" | "payment";
};

/** The one checkout entry-point create-checkout-session and
 *  start-plan-checkout both funnel through. `mode: "payment"` (one-off
 *  top-ups etc.) skips the price/subscription gates entirely — those apply
 *  to recurring subscriptions only. */
export async function openCheckout(
  ctx: HandlerContext,
  options: OpenCheckoutOptions,
  input: OpenCheckoutInput,
): Promise<{ readonly url: string; readonly providerName: string }> {
  const { plugin } = resolveProviderPlugin(ctx, input.providerName);
  if (!plugin.createCheckoutSession) {
    throw new Error(
      `subscription-foundation: provider "${input.providerName}" has no createCheckoutSession-method (e.g. Apple-IAP-only providers). Use the provider's native checkout flow.`,
    );
  }

  assertRedirectOrigins([input.successUrl, input.cancelUrl], options.baseUrl);

  const mode = input.mode ?? "subscription";
  if (mode === "subscription") {
    if (!plugin.priceToTier) {
      throw new UnprocessableError("provider_has_no_price_catalog", {
        i18nKey: "billing-foundation.errors.providerHasNoPriceCatalog",
        message: `subscription-foundation: provider "${input.providerName}" has no priceToTier — cannot verify priceId "${input.priceId}" belongs to a known plan`,
      });
    }
    const tier = plugin.priceToTier[input.priceId];
    if (!tier) {
      throw new UnprocessableError("unknown_price", {
        i18nKey: "billing-foundation.errors.unknownPrice",
        message: `subscription-foundation: priceId "${input.priceId}" is not in provider "${input.providerName}"'s priceToTier`,
      });
    }
    if (options.catalog && !options.catalog.plans.includes(tier)) {
      throw new UnprocessableError("unknown_price", {
        i18nKey: "billing-foundation.errors.unknownPrice",
        message: `subscription-foundation: priceId "${input.priceId}" maps to tier "${tier}", which is not one of the catalog's plans`,
      });
    }

    await assertNoActiveSubscription(ctx);
  }

  const result = await plugin.createCheckoutSession(ctx, {
    priceId: input.priceId,
    tenantId: ctx.user.tenantId,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    ...(input.providerCustomerId && { providerCustomerId: input.providerCustomerId }),
    // Only forwarded when the caller set it explicitly — preserves the
    // pre-hardening wire-contract for callers that never sent `mode`
    // (create-checkout-session's own regression pin).
    ...(input.mode && { mode: input.mode }),
  });
  return { url: result.url, providerName: input.providerName };
}
