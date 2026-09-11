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
  /** Discriminator gegen PaymentEvent. Optional (statt required) damit
   *  bestehende Plugins wie subscription-mollie, die das Feld nicht
   *  setzen, ohne Änderung backward-compatible bleiben — TS narrowt
   *  `parsed.kind === BillingEventKinds.payment` trotzdem korrekt, weil
   *  nur PaymentEvent["kind"] diesen Wert annehmen kann. */
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
// Normalisierter One-off-Payment-Event
// =============================================================================
//
// Separater Typ statt einem sechsten SubscriptionEventTypes-Wert: ein
// one-off-payment ist kein Subscription-State-Übergang (kein status/tier/
// currentPeriodEnd — ein Kauf ist entweder passiert oder nicht) und
// materialisiert in einer eigenen `read_payments`-row statt der
// subscription-row zu überschreiben. Provider-Plugins die keine one-off-
// payments unterstützen (z.B. Mollie-Recurring-only) liefern diesen Typ
// nie — verifyAndParseWebhook returnt für sie unverändert nur
// SubscriptionEvent | null.

export type PaymentEvent = {
  /** Required — unterscheidet diesen Union-member zur Laufzeit von
   *  SubscriptionEvent (dessen `kind` optional + nie "payment" ist). */
  readonly kind: typeof BillingEventKinds.payment;
  /** Provider-eigene Event-ID — UNIQUE-key für Idempotency. */
  readonly providerEventId: string;
  /** Discriminator — welcher Plugin diesen Event geliefert hat. */
  readonly providerName: string;
  /** Plattform-Tenant-ID. **Muss** aus Provider-verifizierten Metadaten
   *  kommen (z.B. der PaymentIntent-metadata, die die App beim Checkout-
   *  Create selbst gesetzt hat) — nie aus einem frei wählbaren Payload-
   *  Feld, sonst könnte ein Angreifer Payments fremden Tenants zuordnen. */
  readonly tenantId: string;
  /** Provider-eigene customer-id. */
  readonly providerCustomerId: string;
  /** Provider-eigene price/plan-ID des gekauften Items. */
  readonly priceId: string;
  /** Raw provider-payload — wird 1:1 in payment-event.rawPayload
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
   * App-wide-secret = App-Owner's eigener Provider-Account. Der Plugin
   * liest ihn entweder aus einem mount-time-Closure ODER — zur Laufzeit
   * rotierbar — aus dem optionalen `systemSecrets`-Arg (system-scoped
   * SecretsContext, vom webhook-handler durchgereicht). `systemSecrets`
   * ist undefined, wenn der App-Owner keinen wired; Plugins müssen dann
   * auf ihren Closure-Fallback zurückfallen.
   *
   * Returns null für events die der Plugin nicht versteht oder die
   * foundation nicht braucht (= filter out, foundation returnt 200
   * "ignored").
   *
   * **Throws** bei sig-mismatch — der webhook-handler mapped das auf
   * 401 damit der Provider keine retries macht (sig-fail = config-bug,
   * nicht transient).
   *
   * Returnt `PaymentEvent` für one-off-payment-webhooks (checkout mode
   * "payment"). Plugins ohne one-off-payment-Support liefern diesen
   * union-member nie — die Return-type-Erweiterung ist covariant, ein
   * `Promise<SubscriptionEvent | null>`-Implementor bleibt ohne Änderung
   * assignable.
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
