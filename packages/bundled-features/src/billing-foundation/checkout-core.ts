/// <reference types="temporal-polyfill/global" preserve="true" />
// Shared checkout plumbing for create-checkout-session, start-plan-checkout
// and switch-plan — provider/catalog resolution, redirect-origin hardening,
// and the price/subscription-state gate that turns a bare priceId-driven
// checkout into a plan-aware one. Internal — not re-exported from index.ts.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  FeatureDisabledError,
  UnconfiguredError,
  UnprocessableError,
} from "@cosmicdrift/kumiko-framework/errors";
import { getSubscriptionForTenant } from "./get-subscription-for-tenant.ts";
import { assertOneOffAuthorized, assertOneOffPriceAllowed } from "./one-off-checkout-gate.ts";
import type {
  BillingFoundationOptions,
  BillingPlanCatalog,
  SubscriptionProviderPlugin,
} from "./types.ts";
import {
  BILLING_FOUNDATION_FEATURE,
  isSubscriptionBlockingCheckout,
  SUBSCRIPTION_PROVIDER_EXTENSION,
} from "./web/constants.ts";

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

/** Every registered provider plugin, in registration order. */
function listProviderPlugins(ctx: HandlerContext): readonly ResolvedProvider[] {
  return ctx.registry.getExtensionUsages(SUBSCRIPTION_PROVIDER_EXTENSION).map((usage) => ({
    name: usage.entityName,
    // @cast-boundary engine-payload — extension-usage carries unknown options
    plugin: usage.options as SubscriptionProviderPlugin,
  }));
}

/** Non-throwing provider lookup by name — null when no plugin with that
 *  entityName is registered. */
export function findProviderPlugin(
  ctx: HandlerContext,
  providerName: string,
): ResolvedProvider | null {
  return listProviderPlugins(ctx).find((provider) => provider.name === providerName) ?? null;
}

export function resolveProviderPlugin(ctx: HandlerContext, providerName: string): ResolvedProvider {
  const found = findProviderPlugin(ctx, providerName);
  if (!found) {
    const known =
      ctx.registry
        .getExtensionUsages(SUBSCRIPTION_PROVIDER_EXTENSION)
        .map((u) => u.entityName)
        .join(", ") || "<none>";
    throw new Error(
      `subscription-foundation: provider "${providerName}" not registered. Known: ${known}.`,
    );
  }
  return found;
}

/** The providers a catalog sells through, in registration order: an explicit
 *  `catalog.providerName` (only that one), otherwise every registered provider
 *  exposing `priceToTier`. Empty when none qualifies, a state `billing-plans`
 *  renders as `enabled: false` instead of erroring. An explicit `providerName`
 *  that is not registered is a config bug and throws `UnconfiguredError`. */
export function listCatalogProviders(
  ctx: HandlerContext,
  catalog: BillingPlanCatalog,
): readonly ResolvedProvider[] {
  if (catalog.providerName) {
    const found = findProviderPlugin(ctx, catalog.providerName);
    if (!found) {
      throw new UnconfiguredError({
        feature: "billing-foundation",
        key: "catalog.providerName",
        hint: `provider "${catalog.providerName}" not registered`,
      });
    }
    return [found];
  }
  return listProviderPlugins(ctx).filter(({ plugin }) => plugin.priceToTier !== undefined);
}

export async function filterOfferedProviders(
  ctx: HandlerContext,
  providers: readonly ResolvedProvider[],
): Promise<readonly ResolvedProvider[]> {
  const enabledFlags = await Promise.all(
    providers.map(({ plugin }) => isPluginBillingEnabled(ctx, plugin)),
  );
  return providers.filter((_, index) => enabledFlags[index]);
}

/** The catalog providers that are live right now: what a buyer can choose from. */
export async function listOfferedCatalogProviders(
  ctx: HandlerContext,
  catalog: BillingPlanCatalog,
): Promise<readonly ResolvedProvider[]> {
  return filterOfferedProviders(ctx, listCatalogProviders(ctx, catalog));
}

/** `plugin.isBillingEnabled?.(ctx) ?? true` — the one place this fallback is
 *  spelled out, so no call-site forgets to await the optional method before
 *  applying the `?? true` default. */
export async function isPluginBillingEnabled(
  ctx: HandlerContext,
  plugin: SubscriptionProviderPlugin,
): Promise<boolean> {
  return (await plugin.isBillingEnabled?.(ctx)) ?? true;
}

/** Throws `FeatureDisabledError` unless the plugin reports billing enabled —
 *  shared by every handler that must refuse to act while billing isn't live
 *  (`openCheckout`, start-plan-checkout, switch-plan). */
export async function assertBillingEnabled(
  ctx: HandlerContext,
  plugin: SubscriptionProviderPlugin,
  handlerName: string,
): Promise<void> {
  const enabled = await isPluginBillingEnabled(ctx, plugin);
  if (!enabled) {
    throw new FeatureDisabledError(BILLING_FOUNDATION_FEATURE, handlerName);
  }
}

/** Public readiness-probe for a named provider — `findProviderPlugin` +
 *  `isPluginBillingEnabled`, re-exported from index.ts so an app-owner can
 *  check billing readiness without reaching into checkout-core internals.
 *  An unregistered provider is a "not live" state, not a config error here
 *  (unlike `resolveProviderPlugin`'s throw) — a readiness probe should
 *  answer false, not throw, for a provider that simply isn't mounted yet. */
export async function isBillingEnabled(
  ctx: HandlerContext,
  providerName: string,
): Promise<boolean> {
  const found = findProviderPlugin(ctx, providerName);
  if (!found) return false;
  return isPluginBillingEnabled(ctx, found.plugin);
}

/** `create-portal-session`'s returnUrl, built server-side (the client no
 *  longer supplies one) — `catalog.returnPath` when set, else `baseUrl`
 *  itself. Sharing `baseUrl`'s origin is guaranteed by construction
 *  (`joinBaseUrl` only ever concatenates onto it), so no separate
 *  `assertRedirectOrigins` call is needed here. */
export function portalReturnUrl(options: {
  readonly baseUrl?: string;
  readonly catalog?: BillingPlanCatalog;
}): string {
  if (options.baseUrl === undefined) {
    throw new UnconfiguredError({
      feature: "billing-foundation",
      key: "baseUrl",
      hint: "pass createBillingFoundationFeature({ baseUrl }) so create-portal-session can build a returnUrl",
    });
  }
  return joinBaseUrl(options.baseUrl, options.catalog?.returnPath ?? "");
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
  now: Temporal.Instant,
): Promise<Awaited<ReturnType<typeof getSubscriptionForTenant>>> {
  const existing = await getSubscriptionForTenant(ctx, ctx.user.tenantId);
  if (existing && isSubscriptionBlockingCheckout(existing, now)) {
    throw new ConflictError({
      i18nKey: "billing-foundation.errors.subscriptionExists",
      message:
        "tenant already has a non-terminal subscription; use billing-foundation:write:switch-plan",
    });
  }
  return existing;
}

/** Pure predicate for `openCheckout`'s providerCustomerId guard — kept
 *  standalone so it stays unit-testable without a `ctx`. */
export function isOwnProviderCustomer(
  ownSubscription: Awaited<ReturnType<typeof getSubscriptionForTenant>>,
  providerName: string,
  providerCustomerId: string,
): boolean {
  return (
    ownSubscription !== null &&
    ownSubscription.providerName === providerName &&
    ownSubscription.providerCustomerId === providerCustomerId
  );
}

export type OpenCheckoutOptions = {
  readonly baseUrl?: string;
  readonly catalog?: BillingPlanCatalog;
  readonly now: () => Temporal.Instant;
  readonly authorizeOneOffCheckout?: BillingFoundationOptions["authorizeOneOffCheckout"];
  /** The caller already ran `assertBillingEnabled` under its own handler name
   *  (before a costly provider lookup), so the gate is not repeated here. */
  readonly billingEnabledChecked?: boolean;
  /** The caller already ran `assertNoActiveSubscription` and passes its result
   *  (null = tenant has none); mode:"subscription" skips the second read and
   *  the providerCustomerId check reuses it. */
  readonly checkedSubscription?: Awaited<ReturnType<typeof getSubscriptionForTenant>>;
};

export type OpenCheckoutInput = {
  readonly providerName: string;
  readonly priceId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly providerCustomerId?: string;
  readonly mode?: "subscription" | "payment";
  readonly consentId?: string;
  readonly locale?: string;
  readonly submitMessage?: string;
};

function assertSubscriptionPriceAllowed(
  plugin: SubscriptionProviderPlugin,
  catalog: BillingPlanCatalog | undefined,
  input: OpenCheckoutInput,
): void {
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
  if (catalog && !catalog.plans.includes(tier)) {
    throw new UnprocessableError("unknown_price", {
      i18nKey: "billing-foundation.errors.unknownPrice",
      message: `subscription-foundation: priceId "${input.priceId}" maps to tier "${tier}", which is not one of the catalog's plans`,
    });
  }
}

type CheckoutCapableProvider = SubscriptionProviderPlugin & {
  readonly createCheckoutSession: NonNullable<SubscriptionProviderPlugin["createCheckoutSession"]>;
};

function canCreateCheckoutSession(
  plugin: SubscriptionProviderPlugin,
): plugin is CheckoutCapableProvider {
  return plugin.createCheckoutSession !== undefined;
}

/** All gates that run before a provider checkout call: provider, billing
 *  enabled, redirect origins, mode gates, foreign provider customer.
 *  `mode: "payment"` (one-off top-ups etc.) skips the price/subscription
 *  gates — those apply to recurring subscriptions only. */
export async function assertCheckoutAllowed(
  ctx: HandlerContext,
  options: OpenCheckoutOptions,
  input: OpenCheckoutInput,
): Promise<CheckoutCapableProvider> {
  const { plugin } = resolveProviderPlugin(ctx, input.providerName);
  if (!canCreateCheckoutSession(plugin)) {
    throw new Error(
      `subscription-foundation: provider "${input.providerName}" has no createCheckoutSession-method (e.g. Apple-IAP-only providers). Use the provider's native checkout flow.`,
    );
  }

  // Checked before the redirect-origin hardening for every mode — a
  // disabled provider must reject a mode:"payment" checkout just as much
  // as a mode:"subscription" one.
  if (options.billingEnabledChecked !== true) {
    await assertBillingEnabled(ctx, plugin, "create-checkout-session");
  }
  assertRedirectOrigins([input.successUrl, input.cancelUrl], options.baseUrl);

  const mode = input.mode ?? "subscription";
  // Reused by the providerCustomerId check below to avoid a second lookup
  // when mode:"subscription" already ran assertNoActiveSubscription.
  let ownSubscription: Awaited<ReturnType<typeof getSubscriptionForTenant>> | undefined;

  if (mode === "subscription") {
    assertSubscriptionPriceAllowed(plugin, options.catalog, input);
    ownSubscription =
      options.checkedSubscription !== undefined
        ? options.checkedSubscription
        : await assertNoActiveSubscription(ctx, options.now());
  } else {
    assertOneOffPriceAllowed(plugin, input);
    await assertOneOffAuthorized(ctx, options.authorizeOneOffCheckout, input);
  }

  // Rejects a foreign tenant's provider-customer id — otherwise the checkout
  // would attach to that customer's stored payment methods and invoices.
  if (input.providerCustomerId) {
    if (ownSubscription === undefined) {
      ownSubscription = await getSubscriptionForTenant(ctx, ctx.user.tenantId);
    }
    if (!isOwnProviderCustomer(ownSubscription, input.providerName, input.providerCustomerId)) {
      throw new UnprocessableError("foreign_provider_customer", {
        i18nKey: "billing-foundation.errors.foreignProviderCustomer",
        message: `subscription-foundation: providerCustomerId "${input.providerCustomerId}" does not belong to this tenant's own subscription at provider "${input.providerName}"`,
      });
    }
  }
  return plugin;
}

export async function startProviderCheckout(
  ctx: HandlerContext,
  plugin: CheckoutCapableProvider,
  input: OpenCheckoutInput,
): Promise<{ readonly url: string; readonly providerName: string }> {
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
    ...(input.consentId && { consentId: input.consentId }),
    ...(input.locale && { locale: input.locale }),
    ...(input.submitMessage && { submitMessage: input.submitMessage }),
  });
  return { url: result.url, providerName: input.providerName };
}

/** The one checkout entry-point start-plan-checkout, switch-plan and the
 *  non-consumer-protection create-checkout-session funnel through. */
export async function openCheckout(
  ctx: HandlerContext,
  options: OpenCheckoutOptions,
  input: OpenCheckoutInput,
): Promise<{ readonly url: string; readonly providerName: string }> {
  const plugin = await assertCheckoutAllowed(ctx, options, input);
  return startProviderCheckout(ctx, plugin, input);
}
