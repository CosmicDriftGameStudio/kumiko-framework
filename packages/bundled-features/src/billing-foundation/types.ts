/// <reference types="temporal-polyfill/global" preserve="true" />
// Plugin contract and domain types for subscription-foundation. Provider
// plugins (subscription-stripe, subscription-mollie, ...) implement
// `SubscriptionProviderPlugin` and register via
// `r.useExtension("subscriptionProvider", "<name>", { build })`.
//
// **Two-phase plugin contract:**
//   1. **Pre-tenant-resolution:** `verifyAndParseWebhook` runs BEFORE
//      a tenant is resolved from the event, so no HandlerContext is
//      available. The **webhook secret is app-wide** (the App Owner's
//      Stripe-/PayPal-account, not tenant-specific). To let a plugin read
//      the secret from the secrets feature AT RUNTIME (instead of a
//      mount-time closure), the webhook handler passes an optional
//      system-scoped `SecretsContext` as the third argument. The plugin
//      reads its app-wide secrets from it without auditing under
//      SYSTEM_TENANT_ID. Plugins that keep their keys in a closure
//      (e.g. mollie) ignore the parameter → backward-compatible.
//   2. **Post-tenant-resolution:** `createPortalSession` +
//      `cancelSubscription` are called from regular write handlers with
//      a fully resolved HandlerContext. The plugin can use ctx.config +
//      ctx.services.secrets for tenant-specific configuration (e.g. tenant-owned
//      customer-id mappings).
//
// Foundation uses only the common subset of provider functionality;
// proration, multi-currency, coupons, etc. remain provider-specific and
// are available through the Customer Portal link.

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type { OrderItem } from "./consumer-protection/consent-gate.ts";
import {
  type BillingEventKinds,
  type BillingPlanAction,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  type SubscriptionCancelTiming,
  type SubscriptionEventType,
  type SubscriptionStatus,
  type TerminationScope,
} from "./web/constants.ts";
import type { ConsentLocale } from "./web/consumer-protection/consent-locale.ts";

// =============================================================================
// Normalized Webhook Event
// =============================================================================
//
// The plugin parses the raw provider payload and returns this shape.
// Foundation has no direct knowledge of Stripe-/Mollie-types; the plugin
// provides the abstraction.

export type SubscriptionEvent = {
  /** Discriminator against PaymentEvent. Optional (instead of required) so
   *  existing plugins like subscription-mollie, which don't set this field,
   *  stay backward-compatible without changes — TS still narrows
   *  `parsed.kind === BillingEventKinds.payment` correctly, because only
   *  PaymentEvent["kind"] can take that value. */
  readonly kind?: typeof BillingEventKinds.subscription;
  /** Provider-owned event ID — UNIQUE key for idempotency.
   *  Stripe: "evt_..."; Mollie: payment-id or subscription-id. */
  readonly providerEventId: string;
  /** Discriminator — welcher Plugin diesen Event geliefert hat. */
  readonly providerName: string;
  /** Normalisierter Event-Type. Plugin filtert provider-spezifische
   *  Sub-Types raus (Stripe hat ~80 Event-types, wir kennen 5). */
  readonly type: SubscriptionEventType;
  /** Platform tenant ID (provider-customer metadata or lookup via
   *  providerCustomerId). The plugin performs the resolution. */
  readonly tenantId: string;
  /** Consent id echoed back from checkout metadata; omitted when absent or
   *  malformed. */
  readonly consentId?: string;
  /** Provider-owned customer ID for later lookup when events lack
   *  metadata. */
  readonly providerCustomerId: string;
  /** Provider-eigene subscription-id. */
  readonly providerSubscriptionId: string;
  /** Normalisierter status. */
  readonly status: SubscriptionStatus;
  /** Resolved tier — the plugin reads the price ID from the event and
   *  maps it through the plugin's `<plugin>:config:price-to-tier` to a
   *  tier name. If the price ID is absent from the mapping, the plugin
   *  returns null from verifyAndParseWebhook (= "unknown event, ignore"). */
  readonly tier: string;
  /** ISO-timestamp wann die aktuelle Billing-Period endet. */
  readonly currentPeriodEnd: string;
  /** ISO instant a scheduled cancellation ends the subscription. null =
   *  it keeps renewing; undefined = the provider doesn't report it (e.g.
   *  Mollie), so projection.ts leaves the column unchanged instead of
   *  nulling it. */
  readonly cancelAt?: string | null;
  /** ISO instant the provider emitted this event. process-event drops a
   *  state event older than the newest one already stored, since providers
   *  do not guarantee delivery order. Omitted by providers that report none. */
  readonly providerEventAt?: string;
};

// =============================================================================
// Normalized One-off-Payment-Event
// =============================================================================
//
// Separate type instead of a sixth SubscriptionEventTypes value: a one-off-
// payment is not a subscription-state transition (no status/tier/
// currentPeriodEnd — a purchase either happened or it didn't) and
// materializes into its own `read_payments`-row instead of overwriting the
// subscription-row. Provider-plugins that don't support one-off-payments
// (e.g. Mollie-recurring-only) never deliver this type — verifyAndParseWebhook
// still returns just SubscriptionEvent | null for them, unchanged.

export type PaymentEvent = {
  /** Required — distinguishes this union member at runtime from
   *  SubscriptionEvent (whose `kind` is optional and never "payment"). */
  readonly kind: typeof BillingEventKinds.payment;
  /** Provider's own event-ID — UNIQUE key for idempotency. */
  readonly providerEventId: string;
  /** Discriminator — which plugin delivered this event. */
  readonly providerName: string;
  /** Platform-tenant-ID. **Must** come from provider-verified metadata
   *  (e.g. the PaymentIntent metadata the app itself set at checkout-
   *  create time) — never from a freely-choosable payload field, or an
   *  attacker could attribute payments to someone else's tenant. */
  readonly tenantId: string;
  /** Consent id echoed back from checkout metadata; omitted when absent or
   *  malformed. */
  readonly consentId?: string;
  /** Provider's checkout/payment object id (Stripe checkout session id) —
   *  lets consumers key their own grants without the raw provider payload. */
  readonly providerCheckoutId?: string;
  /** Provider's own customer-id. */
  readonly providerCustomerId: string;
  /** Provider's own price/plan-ID of the purchased item. */
  readonly priceId: string;
  /** Number of units bought; absent = 1. */
  readonly quantity?: number;
};

// =============================================================================
// Plugin-Contract
// =============================================================================

export type SubscriptionProviderPlugin = {
  /** Human-readable provider name for the plan panel's provider switch. */
  readonly displayName?: string;

  /**
   * Verify webhook signature + parse provider-event into normalized
   * form. **Pre-tenant-resolution** — no HandlerContext, because at
   * sig-verify time the tenant hasn't been resolved yet (the plugin
   * does the tenant-resolution itself from the provider-payload
   * metadata).
   *
   * App-wide-secret = the App-Owner's own provider account. The plugin
   * reads it either from a mount-time closure OR — rotatable at
   * runtime — from the optional `systemSecrets` arg (system-scoped
   * SecretsContext, passed through by the webhook-handler).
   * `systemSecrets` is undefined when the App-Owner hasn't wired one;
   * plugins then fall back to their closure fallback.
   *
   * Returns null for events the plugin doesn't understand or that the
   * foundation doesn't need (= filter out, foundation returns 200
   * "ignored").
   *
   * **Throws** on sig-mismatch — the webhook-handler maps that to 401
   * so the provider doesn't retry (sig-fail = config-bug, not
   * transient).
   *
   * Returns `PaymentEvent` for one-off-payment-webhooks (checkout mode
   * "payment"). Plugins without one-off-payment support never deliver this
   * union member — the return-type extension is covariant, so a
   * `Promise<SubscriptionEvent | null>` implementor stays assignable
   * without any change.
   */
  readonly verifyAndParseWebhook: (
    rawBody: string,
    headers: Record<string, string>,
    systemSecrets?: SecretsContext,
  ) => Promise<SubscriptionEvent | PaymentEvent | null>;

  /**
   * **Post-tenant-resolution** — called from the
   * `create-checkout-session` write handler. The plugin builds a
   * provider-specific checkout session and returns its hosted-page URL;
   * the tenant admin is redirected there to complete payment, and the
   * provider sends a `subscription.created` webhook with
   * `metadata.tenantId`.
   *
   * Optional: Apple-IAP has no web checkout (everything happens in the app).
   * Apps that use only Apple-IAP omit this field.
   */
  readonly createCheckoutSession?: (
    ctx: HandlerContext,
    options: {
      /** Provider-owned price/plan ID that the customer subscribes to. */
      readonly priceId: string;
      /** Platform tenant ID — stored as metadata in the checkout session
       *  so the subsequent webhook can resolve the tenant (see the
       *  `verifyAndParseWebhook` metadata.tenantId lookup). */
      readonly tenantId: string;
      /** Where the customer lands after a successful checkout. */
      readonly successUrl: string;
      /** Where the customer lands if they cancel. */
      readonly cancelUrl: string;
      /** Optional: existing provider customer ID when the tenant already
       *  has an account with the provider. Otherwise, the provider
       *  creates a new customer during checkout. */
      readonly providerCustomerId?: string;
      /** Checkout mode. `"subscription"` (default) starts a recurring
       *  billing flow; `"payment"` a one-off checkout (e.g. pay-per-use
       *  credit top-ups). Optional with default `"subscription"` — existing
       *  callers are unaffected. */
      readonly mode?: "subscription" | "payment";
      /** Id of the consumer-protection consent recorded for this checkout.
       *  Travels as provider metadata and comes back on the webhook event. */
      readonly consentId?: string;
      /** App locale (BCP-47-ish, e.g. "de", "de-DE") for the hosted page. */
      readonly locale?: string;
      /** Text shown next to the submit button on the hosted page. */
      readonly submitMessage?: string;
    },
  ) => Promise<{ readonly url: string }>;

  /**
   * **Post-tenant-resolution** — called from a write handler with a
   * fully resolved ctx. Creates a self-service Portal link.
   * Stripe: customer-portal-session, Mollie: hosted-management-page.
   * The tenant admin uses it to manage the subscription themselves
   * (cancel, payment method, ...).
   *
   * Optional because not every provider has a Portal pattern
   * (Apple-IAP subscriptions are managed in the Apple app, with no web
   * Portal). A plugin that does not support this can omit the field;
   * the foundation then returns a "portal_not_supported" error when a
   * tenant admin requests the Portal link.
   */
  readonly createPortalSession?: (
    ctx: HandlerContext,
    options: {
      readonly providerCustomerId: string;
      readonly returnUrl: string;
    },
  ) => Promise<{ readonly url: string }>;

  /**
   * Optional: in-app cancellation API. If not implemented, the tenant
   * can cancel only through the Customer Portal link (or not at all if
   * createPortalSession is also missing — the cancellation flow is then
   * provider-dashboard-only).
   */
  readonly cancelSubscription?: (
    ctx: HandlerContext,
    options: {
      readonly providerSubscriptionId: string;
      readonly when: SubscriptionCancelTiming;
    },
  ) => Promise<void>;

  /**
   * Optional: takes back a `period-end` cancellation that has not taken effect
   * yet. Without it, a revoked public termination is reported to the operator
   * to undo by hand.
   */
  readonly resumeSubscription?: (
    ctx: HandlerContext,
    options: { readonly providerSubscriptionId: string },
  ) => Promise<void>;

  /**
   * The provider's own price/plan-id → app-tier-name mapping. This is the
   * one source `checkout-core`/`plan-catalog` derive both hardening
   * (unknown-priceId rejection) and the billing-plans catalog from — see
   * `architektur/billing-price-to-tier-quelle`. Optional only for
   * backward-compat with providers that predate this field (their
   * `create-checkout-session` calls now reject every mode:"subscription"
   * price as `provider_has_no_price_catalog` until they add it).
   */
  readonly priceToTier?: Readonly<Record<string, string>>;

  /**
   * Allowlist of the provider's own price/plan-ids that may be checked out
   * with `mode: "payment"` (one-off top-ups etc.) — mirrors `priceToTier`'s
   * role for `mode: "subscription"`. Missing or empty → every mode:"payment"
   * checkout is rejected as `unknown_price`, since without a list there is
   * no way to tell a legitimate one-off price from an arbitrary caller-
   * supplied string.
   */
  readonly oneOffPriceIds?: readonly string[];

  /**
   * Whether the provider is ready to accept live checkouts right now
   * (credentials configured, master-switch on, ...). Missing → foundation
   * treats billing as enabled (no readiness gate to check).
   */
  readonly isBillingEnabled?: (ctx: HandlerContext) => Promise<boolean>;

  /**
   * Bulk price lookup for the billing-plans catalog. Missing → every plan's
   * price stays null (catalog still renders, just without live prices).
   * A priceId the provider can't load (deleted, wrong account, ...) is
   * simply absent from the result — no throw per-price.
   */
  readonly retrievePrices?: (
    ctx: HandlerContext,
    priceIds: readonly string[],
  ) => Promise<readonly ProviderPrice[]>;

  /**
   * Opens the provider's own confirmation page for switching an existing,
   * non-terminal subscription to a different plan tier (Stripe: a Customer
   * Portal `subscription_update_confirm` flow). Missing → the foundation
   * rejects `switch-plan` with `plan_switch_not_supported`.
   */
  readonly createPlanSwitchSession?: (
    ctx: HandlerContext,
    options: {
      readonly providerSubscriptionId: string;
      readonly targetPriceId: string;
      readonly allowedPriceIds: readonly string[];
      readonly returnUrl: string;
    },
  ) => Promise<{ readonly url: string }>;

  /**
   * In-app plan switch, step 1: what the switch would cost right now. Together
   * with `applyPlanSwitch` an alternative to the hosted `createPlanSwitchSession`.
   */
  readonly previewPlanSwitch?: (
    ctx: HandlerContext,
    options: {
      readonly providerSubscriptionId: string;
      readonly targetPriceId: string;
    },
  ) => Promise<PlanSwitchPreview>;

  /**
   * In-app plan switch, step 2: performs the switch at the provider. The
   * state change itself arrives later through the webhook.
   */
  readonly applyPlanSwitch?: (
    ctx: HandlerContext,
    options: {
      readonly providerSubscriptionId: string;
      readonly targetPriceId: string;
      readonly tenantId: string;
      readonly consentId?: string;
    },
  ) => Promise<void>;

  /**
   * Fetches the live provider-side state of one subscription, for the
   * `sync-subscriptions` backfill job — catches drift (e.g. a `cancel_at`
   * set on the provider's own dashboard) that never reached us as a
   * webhook. Missing → sync-subscription reports `provider_cannot_retrieve`
   * instead of throwing. Null → the implementation could not resolve a
   * snapshot for this id — the subscription no longer exists at the
   * provider (deleted account, ...), or its state no longer maps onto this
   * app's config (e.g. Stripe's price-to-tier — same silent-drop the
   * webhook path already applies to an unmapped price).
   */
  readonly retrieveSubscription?: (
    ctx: HandlerContext,
    providerSubscriptionId: string,
  ) => Promise<ProviderSubscriptionSnapshot | null>;
};

export type PlanSwitchPreview = {
  /** Charged immediately, smallest currency unit, tax included. */
  readonly amountDueNow: number;
  /** Tax part of `amountDueNow`; null when the provider reports none. */
  readonly tax: number | null;
  /** Lower-case ISO currency code. */
  readonly currency: string;
  /** Credit for the unused time on the old plan, smallest currency unit. */
  readonly credit: number;
  /** Recurring price per period as charged by the provider, smallest unit, tax included. */
  readonly recurringAmount?: number;
  /** Tax part of `recurringAmount`; null when the provider reports none. */
  readonly recurringTax?: number | null;
  readonly effectiveAt: string;
};

export type ProviderSubscriptionSnapshot = {
  readonly providerCustomerId: string;
  readonly providerSubscriptionId: string;
  readonly status: SubscriptionStatus;
  readonly tier: string;
  /** ISO instant string, same shape as `SubscriptionEventPayload.currentPeriodEndIso`. */
  readonly currentPeriodEnd: string;
  readonly cancelAt: string | null;
};

// =============================================================================
// Provider price + billing-plans catalog
// =============================================================================

// Closed set a provider's recurring-price interval narrows to; an unrecognized provider value maps to null instead of widening this type.
export const KNOWN_RECURRING_INTERVALS = ["day", "week", "month", "year"] as const;
export type RecurringInterval = (typeof KNOWN_RECURRING_INTERVALS)[number];

export type ProviderPrice = {
  readonly priceId: string;
  /** Smallest currency unit (e.g. cents). Null for prices with no flat
   *  amount (tiered/usage-based prices). */
  readonly unitAmount: number | null;
  /** Lower-case ISO currency code, as returned by the provider. */
  readonly currency: string;
  /** Null for a one-off (non-recurring) price, or an interval the provider
   *  returned that isn't in KNOWN_RECURRING_INTERVALS. */
  readonly interval: RecurringInterval | null;
  readonly intervalCount: number | null;
  readonly active: boolean;
  readonly metadata: Readonly<Record<string, string>>;
};

export type BillingPlanBenefit = {
  readonly labelKey: string;
  readonly params?: Readonly<Record<string, string | number>>;
};

/** Price-less card (e.g. "Enterprise · Contact us"); `href` must be an absolute https: or mailto: URL. */
export type BillingPlanContactCard = {
  readonly labelKey: string;
  readonly benefits: readonly BillingPlanBenefit[];
  readonly actionLabelKey: string;
  readonly href: string;
};

export type BillingPlanCatalog<TTier extends string = string> = {
  /** Purchasable tiers, in display order. */
  readonly plans: readonly TTier[];
  /** Also used for the caller's current tier even when it isn't purchasable
   *  (e.g. a legacy or free tier not in `plans`). */
  readonly tierLabelKey: (tier: string) => string;
  // `string`, not `TTier` — matches `tierLabelKey` above and lets
  // `BillingFoundationOptions<TTier>` widen to `BillingFoundationOptions`
  // (plain `string`) inside the foundation's own handlers without a cast.
  // Callers only ever invoke this with values drawn from `catalog.plans`.
  readonly benefits: (tier: string) => readonly BillingPlanBenefit[];
  readonly resolveCurrentTier: (db: TenantDb, tenantId: TenantId) => Promise<string>;
  readonly viewRoles: readonly string[];
  /** Defaults to DEFAULT_PURCHASE_ROLES. */
  readonly purchaseRoles?: readonly string[];
  /** Appended to `baseUrl` after a successful plan checkout; must start
   *  with "/" (and not "//"). */
  readonly successPath: string;
  readonly cancelPath: string;
  /** Portal return-path — used both by `create-portal-session` (defaults to
   *  `baseUrl` itself when unset) and by `switch-plan` after a plan switch
   *  (defaults to `successPath` there instead). */
  readonly returnPath?: string;
  /** Restricts the catalog to one provider; defaults to every registered
   *  provider exposing `priceToTier`. */
  readonly providerName?: string;
  /** Rendered as the last card, no price, visible to `viewRoles` regardless of `purchaseRoles`. */
  readonly contact?: BillingPlanContactCard;
  /** App i18n key for a small note under every card's price, e.g. "plus VAT" when catalog prices are net. */
  readonly priceNoteKey?: string;
};

export type LegalLinkSet = {
  readonly terms: string;
  readonly withdrawal: string;
  readonly privacy: string;
};

export function isLegalLinkSet(
  links: LegalLinkSet | Readonly<Record<ConsentLocale, LegalLinkSet>>,
): links is LegalLinkSet {
  return "terms" in links;
}

/** Consumer-protection consent gate (§ 312j / § 356 BGB style). When set,
 *  `start-plan-checkout` and `create-checkout-session` require a `consent`
 *  payload and record it as an event before the buyer reaches the provider.
 *  Every provider used with `create-checkout-session` must implement
 *  `retrievePrices`: the live price is part of the consent record, and a
 *  provider without it fails the checkout with an InternalError. */
export type ConsumerProtectionOptions = {
  /** Slug of the template-resolver `text-block` holding the terms text; its
   *  content hash is stored with every recorded consent. */
  readonly termsTextBlock: string;
  /** Per-locale VAT note; must carry at least `de` and `en`. */
  readonly vatNote: Readonly<Record<string, string>>;
  /** Per-provider texts keyed by provider name, e.g. for a merchant-of-record
   *  provider that issues the invoice and VAT itself. `vatNote` here replaces
   *  the global one in that provider's confirmation mail; `checkoutNote` is
   *  shown under the provider choice. de and en are required for each text. */
  readonly providerTexts?: Readonly<
    Record<
      string,
      {
        readonly vatNote?: Readonly<Record<string, string>>;
        readonly checkoutNote?: Readonly<Record<string, string>>;
      }
    >
  >;
  readonly operatorEmail: string;
  /** Where the public § 312k declaration is reachable. `"tenant-host"`
   *  (default): on a host that resolves a tenant. `"platform"`: also on a
   *  host that resolves none (the platform apex) — the declaration then runs
   *  without a request tenant and finds the contract by the declarant's email. */
  readonly terminationScope?: TerminationScope;
  /** Names the item of a one-off payment (mode "payment") for the consent record
   *  and the confirmation mail; the label key is resolved through the registry
   *  i18n, so it must be qualified with the registering feature. The label key
   *  is 1-200 characters, string params at most 100; a violation fails the
   *  checkout with an InternalError before the provider session is created. */
  readonly oneOffItemLabel?: (
    ctx: HandlerContext,
    priceId: string,
  ) => Promise<OrderItem | undefined>;
  /** Root-relative paths or absolute https URLs. One set for every locale, or
   *  one set per consent locale (`de` and `en` required). */
  readonly legalLinks: LegalLinkSet | Readonly<Record<ConsentLocale, LegalLinkSet>>;
};

export type OneOffCheckoutRequest = {
  readonly tenantId: TenantId;
  readonly providerName: string;
  readonly priceId: string;
};

export type OneOffCheckoutVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly i18nKey: string };

export type BillingFoundationOptions<TTier extends string = string> = {
  /** Absolute http(s) URL. Its origin is the only redirect origin
   *  create-checkout-session/create-portal-session (when set) and the plan
   *  handlers accept — see checkout-core's `assertRedirectOrigins`. May
   *  carry a path prefix (e.g. "https://app.example.com/tenant-x"); plan
   *  URLs are built by string-concatenating it with the plan paths below,
   *  NOT via `new URL(path, baseUrl)` (which would drop the prefix). */
  readonly baseUrl?: string;
  readonly catalog?: BillingPlanCatalog<TTier>;
  /** Runs before every one-off (mode "payment") checkout, after the oneOffPriceIds gate and
   *  before any provider call; a rejection becomes an UnprocessableError with `reason` as code. */
  readonly authorizeOneOffCheckout?: (
    ctx: HandlerContext,
    request: OneOffCheckoutRequest,
  ) => Promise<OneOffCheckoutVerdict>;
  /** Enables the consent gate on checkout; requires `baseUrl`. */
  readonly consumerProtection?: ConsumerProtectionOptions;
  /** Injectable clock for the stale-incomplete-subscription check
   *  (constants.ts's `isSubscriptionBlockingCheckout`) — same always-
   *  optional, real-time-default shape as `createDekCache`'s `now` option.
   *  Defaults to `Temporal.Now.instant` when omitted. */
  readonly now?: () => Temporal.Instant;
};

/** `BillingFoundationOptions` after `createBillingFoundationFeature`'s own
 *  defaulting — `now` is always present. Handler-factories that call
 *  `options.now()` take this instead of the still-optional public type. */
export type ResolvedBillingFoundationOptions = BillingFoundationOptions & {
  readonly now: () => Temporal.Instant;
};

export type BillingPlanPrice = {
  readonly unitAmount: number;
  readonly currency: string;
  readonly interval: ProviderPrice["interval"];
  readonly intervalCount: number | null;
};

export type BillingPlanView = {
  readonly tier: string;
  readonly labelKey: string;
  readonly price: BillingPlanPrice | null;
  readonly benefits: readonly BillingPlanBenefit[];
  readonly isCurrent: boolean;
  readonly action: BillingPlanAction;
};

export type BillingProviderView = {
  readonly name: string;
  readonly displayName: string;
  readonly note?: Readonly<Record<string, string>>;
  readonly plans: readonly BillingPlanView[];
};

export function canSwitchPlansInApp(plugin: SubscriptionProviderPlugin): boolean {
  return plugin.previewPlanSwitch !== undefined && plugin.applyPlanSwitch !== undefined;
}

/** A provider switches plans via a hosted session or via in-app preview + apply. */
export function canSwitchPlans(plugin: SubscriptionProviderPlugin | null): boolean {
  if (plugin === null) return false;
  return plugin.createPlanSwitchSession !== undefined || canSwitchPlansInApp(plugin);
}

export type BillingPlansResult = {
  readonly enabled: boolean;
  readonly currentTier: {
    readonly tier: string;
    readonly labelKey: string;
    readonly benefits: readonly BillingPlanBenefit[];
  };
  readonly subscription: {
    readonly status: string;
    readonly tier: string;
    readonly terminal: boolean;
    readonly currentPeriodEnd: string;
    readonly cancelAt: string | null;
  } | null;
  readonly canPurchase: boolean;
  readonly plans: readonly BillingPlanView[];
  /** Present when more than one provider is offered, or the single offered
   *  provider has a `providerTexts` checkout note. `plans` above are the first
   *  entry's plans. */
  readonly providers?: readonly BillingProviderView[];
  /** True when the subscription's provider switches plans in-app (preview +
   *  confirm) instead of on a hosted page. */
  readonly inAppPlanSwitch?: true;
  /** Present only when `catalog.contact` is configured. */
  readonly contact?: BillingPlanContactCard;
  /** Present only when `catalog.priceNoteKey` is configured. */
  readonly priceNoteKey?: string;
  /** Present only when `consumerProtection` is configured. */
  readonly consumerProtection?: {
    readonly consentTexts: Readonly<
      Record<
        "de" | "en",
        {
          readonly earlyPerformance: string;
          readonly withdrawalLoss: string;
          readonly consentTextVersion: string;
        }
      >
    >;
    readonly legalLinks: Readonly<Record<ConsentLocale, LegalLinkSet>>;
  };
};

// r.useExtension options-shape, co-located since the framework never imports upward.
declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [SUBSCRIPTION_PROVIDER_EXTENSION]: SubscriptionProviderPlugin;
  }
}
