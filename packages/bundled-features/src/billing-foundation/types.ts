// Plugin-Contract + Domain-Types der subscription-foundation. Provider-
// Plugins (subscription-stripe, subscription-mollie, ...) implementieren
// `SubscriptionProviderPlugin` und registrieren via
// `r.useExtension("subscriptionProvider", "<name>", { build })`.
//
// **Two-phase plugin contract:**
//   1. **Pre-tenant-resolution:** `verifyAndParseWebhook` läuft BEVOR
//      ein Tenant aus dem Event aufgelöst ist — kein HandlerContext
//      verfügbar. Das **Webhook-secret ist app-wide** (App-Owner's
//      Stripe-/PayPal-Account, nicht Tenant-Sache). Damit ein Plugin den
//      secret ZUR LAUFFZEIT aus dem secrets-Feature lesen kann (statt aus
//      einem mount-time-Closure), reicht der webhook-handler einen
//      optionalen system-scoped `SecretsContext` als 3. Arg durch — der
//      Plugin liest seine app-wide-Secrets daraus un-audited unter
//      SYSTEM_TENANT_ID. Plugins, die ihre Keys weiter aus einem Closure
//      halten (z.B. mollie), ignorieren den Param → backward-compatible.
//   2. **Post-tenant-resolution:** `createPortalSession` +
//      `cancelSubscription` werden aus regulären write-handlern
//      gerufen mit voll-aufgelöstem HandlerContext. Plugin kann
//      hier ctx.config + ctx.secrets nutzen für tenant-spezifische
//      Konfiguration (z.B. tenant-eigene customer-id-mapping).
//
// Foundation nutzt nur den common-subset der Provider-Funktionalität —
// proration, multi-currency, coupons etc. bleiben provider-spezifisch
// und sind über den Customer-Portal-Link erreichbar.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type { BillingEventKinds, SubscriptionEventType, SubscriptionStatus } from "./constants";

// =============================================================================
// Normalisierter Webhook-Event
// =============================================================================
//
// Der Plugin parsed den raw provider-payload und liefert diese Form
// zurück. Foundation kennt KEINE Stripe-/Mollie-types direkt — der
// Plugin abstrahiert.

export type SubscriptionEvent = {
  /** Discriminator against PaymentEvent. Optional (instead of required) so
   *  existing plugins like subscription-mollie, which don't set this field,
   *  stay backward-compatible without changes — TS still narrows
   *  `parsed.kind === BillingEventKinds.payment` correctly, because only
   *  PaymentEvent["kind"] can take that value. */
  readonly kind?: typeof BillingEventKinds.subscription;
  /** Provider-eigene Event-ID — UNIQUE-key für Idempotency.
   *  Stripe: "evt_..."; Mollie: payment-id oder subscription-id. */
  readonly providerEventId: string;
  /** Discriminator — welcher Plugin diesen Event geliefert hat. */
  readonly providerName: string;
  /** Normalisierter Event-Type. Plugin filtert provider-spezifische
   *  Sub-Types raus (Stripe hat ~80 Event-types, wir kennen 5). */
  readonly type: SubscriptionEventType;
  /** Plattform-Tenant-ID (provider-customer-metadata oder lookup
   *  via providerCustomerId). Plugin macht die resolution. */
  readonly tenantId: string;
  /** Provider-eigene customer-id für späteren Lookup bei events
   *  ohne metadata. */
  readonly providerCustomerId: string;
  /** Provider-eigene subscription-id. */
  readonly providerSubscriptionId: string;
  /** Normalisierter status. */
  readonly status: SubscriptionStatus;
  /** Resolved tier — Plugin liest die price-id aus dem event und
   *  mapped via plugin-eigenem `<plugin>:config:price-to-tier` auf
   *  einen tier-name. Wenn der price-id im Mapping fehlt, returnt
   *  der Plugin null aus verifyAndParseWebhook (= "unknown event,
   *  ignore"). */
  readonly tier: string;
  /** ISO-timestamp wann die aktuelle Billing-Period endet. */
  readonly currentPeriodEnd: string;
  /** Raw provider-payload — wird 1:1 in subscription-event.rawPayload
   *  archiviert. Plugin liefert das als JSON-stringified-string. */
  readonly rawPayload: string;
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
  /** Provider's own customer-id. */
  readonly providerCustomerId: string;
  /** Provider's own price/plan-ID of the purchased item. */
  readonly priceId: string;
  /** Raw provider-payload — archived 1:1 into payment-event.rawPayload.
   *  Plugin delivers this as a JSON-stringified string. */
  readonly rawPayload: string;
};

// =============================================================================
// Plugin-Contract
// =============================================================================

export type SubscriptionProviderPlugin = {
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
   * **Post-tenant-resolution** — wird aus dem
   * `create-checkout-session`-write-handler gerufen. Plugin baut
   * eine provider-eigene checkout-session und returnt die hosted-
   * page-URL — Tenant-Admin wird dorthin redirected, schließt den
   * Bezahl-Flow ab, Provider sendet `subscription.created`-webhook
   * mit `metadata.tenantId` zurück.
   *
   * Optional: Apple-IAP hat keinen Web-Checkout (alles in der App).
   * Apps die ausschließlich Apple-IAP nutzen lassen das weg.
   */
  readonly createCheckoutSession?: (
    ctx: HandlerContext,
    options: {
      /** Provider-eigene price/plan-ID die der Endkunde abonniert. */
      readonly priceId: string;
      /** Plattform-Tenant-ID — landet als metadata im checkout-session
       *  damit der subsequent webhook den tenant resolved (siehe
       *  `verifyAndParseWebhook`'s metadata.tenantId-lookup). */
      readonly tenantId: string;
      /** Wo der Endkunde nach erfolgreichem checkout landed. */
      readonly successUrl: string;
      /** Wo der Endkunde landed wenn er abbricht. */
      readonly cancelUrl: string;
      /** Optional: existierende provider-customer-id wenn der Tenant
       *  schon einen Account beim Provider hat. Sonst legt der Provider
       *  beim checkout einen neuen customer an. */
      readonly providerCustomerId?: string;
      /** Checkout mode. `"subscription"` (default) starts a recurring
       *  billing flow; `"payment"` a one-off checkout (e.g. pay-per-use
       *  credit top-ups). Optional with default `"subscription"` — existing
       *  callers are unaffected. */
      readonly mode?: "subscription" | "payment";
    },
  ) => Promise<{ readonly url: string }>;

  /**
   * **Post-tenant-resolution** — wird aus einem write-handler gerufen
   * mit voll-aufgelöstem ctx. Erstellt einen self-service Portal-Link.
   * Stripe: customer-portal-session, Mollie: hosted-management-page.
   * Tenant-Admin klickt darauf um Subscription selbst zu verwalten
   * (cancel, payment-method, ...).
   *
   * Optional weil nicht jeder Provider einen Portal-Pattern hat
   * (Apple-IAP managed Subs in der Apple-App, kein Web-Portal).
   * Plugin der das nicht supported kann das Field weglassen — foundation
   * returnt dann "portal_not_supported"-error wenn ein Tenant-Admin
   * den Portal-Link anfordert.
   */
  readonly createPortalSession?: (
    ctx: HandlerContext,
    options: {
      readonly providerCustomerId: string;
      readonly returnUrl: string;
    },
  ) => Promise<{ readonly url: string }>;

  /**
   * Optional: Cancel-aus-der-App-API. Wenn nicht implementiert, kann
   * der Tenant nur über den Customer-Portal-Link cancellen (oder gar
   * nicht, wenn auch createPortalSession fehlt — dann ist
   * Cancel-Flow Provider-Dashboard-only).
   */
  readonly cancelSubscription?: (
    ctx: HandlerContext,
    providerSubscriptionId: string,
  ) => Promise<void>;
};
