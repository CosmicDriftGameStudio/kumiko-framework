// Plugin-Contract + Domain-Types der subscription-foundation. Provider-
// Plugins (subscription-stripe, subscription-mollie, ...) implementieren
// `SubscriptionProviderPlugin` und registrieren via
// `r.useExtension("subscriptionProvider", "<name>", { build })`.
//
// **Two-phase plugin contract:**
//   1. **Pre-tenant-resolution:** `verifyAndParseWebhook` läuft BEVOR
//      ein Tenant aus dem Event aufgelöst ist — kein HandlerContext
//      verfügbar. Plugin liest seinen webhook-secret aus
//      module-load-Closure (ENV-VAR oder system-config), NICHT aus
//      ctx. **Webhook-secret ist app-wide**, nicht per-tenant — das
//      ist App-Owner's Stripe-/PayPal-Account, nicht Tenant-Sache.
//   2. **Post-tenant-resolution:** `createPortalSession` +
//      `cancelSubscription` werden aus regulären write-handlern
//      gerufen mit voll-aufgelöstem HandlerContext. Plugin kann
//      hier ctx.config + ctx.secrets nutzen für tenant-spezifische
//      Konfiguration (z.B. tenant-eigene customer-id-mapping).
//
// Foundation nutzt nur den common-subset der Provider-Funktionalität —
// proration, multi-currency, coupons etc. bleiben provider-spezifisch
// und sind über den Customer-Portal-Link erreichbar.

import type { HandlerContext } from "@kumiko/framework/engine";
import type { SubscriptionEventType, SubscriptionStatus } from "./constants";

// =============================================================================
// Normalisierter Webhook-Event
// =============================================================================
//
// Der Plugin parsed den raw provider-payload und liefert diese Form
// zurück. Foundation kennt KEINE Stripe-/Mollie-types direkt — der
// Plugin abstrahiert.

export type SubscriptionEvent = {
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
// Plugin-Contract
// =============================================================================

export type SubscriptionProviderPlugin = {
  /**
   * Verify webhook signature + parse provider-event into normalized
   * form. **Pre-tenant-resolution** — kein HandlerContext, weil zum
   * Zeitpunkt des sig-verify der Tenant noch nicht aufgelöst ist
   * (Plugin macht die Tenant-Resolution selbst aus dem provider-
   * payload metadata).
   *
   * Plugin liest seinen webhook-secret aus module-load-Closure
   * (process.env.STRIPE_WEBHOOK_SECRET oder system-config), NICHT
   * aus ctx. App-wide-secret = App-Owner's eigener Provider-Account.
   *
   * Returns null für events die der Plugin nicht versteht oder die
   * foundation nicht braucht (= filter out, foundation returnt 200
   * "ignored").
   *
   * **Throws** bei sig-mismatch — der webhook-handler mapped das auf
   * 401 damit der Provider keine retries macht (sig-fail = config-bug,
   * nicht transient).
   */
  readonly verifyAndParseWebhook: (
    rawBody: string,
    headers: Record<string, string>,
  ) => Promise<SubscriptionEvent | null>;

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
