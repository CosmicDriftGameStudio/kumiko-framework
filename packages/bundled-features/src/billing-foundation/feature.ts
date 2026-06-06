// kumiko-feature-version: 1
//
// subscription-foundation als Kumiko bundled feature (Plugin-Host).
//
// **Multi-Provider von Tag 1** — der App-Builder kann mehrere Plugins
// parallel mounten (subscription-stripe + subscription-paypal +
// subscription-apple-iap + ...) und der Endkunde wählt beim Subscribe-
// Klick zwischen Karte/PayPal/Apple-Pay/Klarna/SEPA (Disney+-Pattern).
// KEIN globaler `provider`-config-key — alle gemounteten Plugins sind
// aktiv.
//
// **Was diese Foundation liefert:**
//   1. **Plugin-API** für Subscription-Provider via `r.extendsRegistrar(
//      "subscriptionProvider", ...)`.
//   2. **5 Domain-Events** auf dem `subscription`-stream (eine
//      stream-id pro Tenant): created/updated/canceled/invoice-paid/
//      invoice-payment-failed. Audit-history kommt frei vom event-store.
//   3. **Inline-Projection** auf `read_subscriptions` (= current state
//      pro Tenant). Apply läuft in derselben TX wie der event-append
//      → read-your-own-write semantics.
//   4. **process-event-handler**: programmatic write-handler den der
//      webhook-handler aufruft, dispatcht zu type-passendem appendEvent.
//   5. **createSubscriptionWebhookHandler**: factory für die HTTP-Route
//      `/api/subscription/webhook/:providerName`.
//
// **Was diese Foundation NICHT macht:**
//   - Kein r.entity für `subscription`. Die Tabelle ist eine reine
//     Read-Projection — kein CRUD-Pfad. Schreibt wird ausschließlich
//     via projection-apply, getriggert von einem der 5 events.
//   - Kein Tier-Sync zum tier-engine. App-Owner liest die subscription-
//     row via `getSubscriptionForTenant(ctx, tenantId)` wenn er möchte.
//   - Keine provider-spezifischen Configs.
//   - Kein Marketplace-Use-Case (App-Tenant billed Endkunden via
//     Stripe Connect). Kommt als separate `marketplace-foundation`.
//
// **Provider-Wechsel:** Disney+-Pattern (= Tenant cancelt Stripe-sub,
// startet neue mit PayPal) wird heute als zweiter `subscription-created`-
// event modelliert. UPSERT in der projection-apply überschreibt den
// existing row mit dem neuen providerName. Reicht für MVP. Wenn das
// business-fact "Provider-Wechsel" ein eigenes domain-event braucht
// (z.B. für analytics: "wie viele Wechsel im Monat?"), kommt ein
// `subscription-provider-changed`-event-type später.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { BILLING_FOUNDATION_FEATURE, SUBSCRIPTION_PROVIDER_EXTENSION } from "./constants";
import {
  INVOICE_PAID_EVENT_QN,
  INVOICE_PAID_EVENT_SHORT,
  INVOICE_PAYMENT_FAILED_EVENT_QN,
  INVOICE_PAYMENT_FAILED_EVENT_SHORT,
  SUBSCRIPTION_AGGREGATE_TYPE,
  SUBSCRIPTION_CANCELED_EVENT_QN,
  SUBSCRIPTION_CANCELED_EVENT_SHORT,
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_SHORT,
  SUBSCRIPTION_UPDATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_SHORT,
  subscriptionEventPayloadSchema,
} from "./events";
import { createCheckoutSessionHandler } from "./handlers/create-checkout-session.write";
import { createPortalSessionHandler } from "./handlers/create-portal-session.write";
import { listSubscriptionsQuery } from "./handlers/list-subscriptions.query";
import { processEventHandler } from "./handlers/process-event.write";
import {
  applyInvoicePaid,
  applyInvoicePaymentFailed,
  applySubscriptionCanceled,
  applySubscriptionCreated,
  applySubscriptionUpdated,
  subscriptionsProjectionTable,
} from "./projection";

export const billingFoundationFeature = defineFeature(BILLING_FOUNDATION_FEATURE, (r) => {
  r.describe(
    "Plugin host for subscription billing \u2014 manages the `read_subscriptions` projection table and exposes 5 domain events (subscription created/updated/canceled, invoice paid/failed) appended by the foundation's own `billing-foundation:write:process-event` write-handler after provider plugins verify and normalize each webhook. Also ships `billing-foundation:write:create-checkout-session` and `billing-foundation:write:create-portal-session` write-handlers, a `billing-foundation:query:subscription:list` query handler, and a `createSubscriptionWebhookHandler` factory for the `/api/subscription/webhook/:providerName` route. Low-level building block \u2014 use `subscription-stripe` or `subscription-mollie` unless you are writing a new payment provider.",
  );
  // 5 fine-grained domain-events. Alle 5 nutzen denselben payload-
  // shape (= subscription-state-snapshot); der event-type taggt was
  // passiert ist. Future-consumer (billing-history, accounting)
  // listenen direkt auf den event-type ohne payload-discriminator.
  r.defineEvent(SUBSCRIPTION_CREATED_EVENT_SHORT, subscriptionEventPayloadSchema);
  r.defineEvent(SUBSCRIPTION_UPDATED_EVENT_SHORT, subscriptionEventPayloadSchema);
  r.defineEvent(SUBSCRIPTION_CANCELED_EVENT_SHORT, subscriptionEventPayloadSchema);
  r.defineEvent(INVOICE_PAID_EVENT_SHORT, subscriptionEventPayloadSchema);
  r.defineEvent(INVOICE_PAYMENT_FAILED_EVENT_SHORT, subscriptionEventPayloadSchema);

  // Inline projection: materialized current state in `read_subscriptions`.
  // Apply läuft in derselben TX wie ctx.unsafeAppendEvent — read-your-
  // own-write ohne dispatcher-tick.
  r.projection({
    name: "subscription",
    source: SUBSCRIPTION_AGGREGATE_TYPE,
    table: subscriptionsProjectionTable,
    apply: {
      [SUBSCRIPTION_CREATED_EVENT_QN]: applySubscriptionCreated,
      [SUBSCRIPTION_UPDATED_EVENT_QN]: applySubscriptionUpdated,
      [SUBSCRIPTION_CANCELED_EVENT_QN]: applySubscriptionCanceled,
      [INVOICE_PAID_EVENT_QN]: applyInvoicePaid,
      [INVOICE_PAYMENT_FAILED_EVENT_QN]: applyInvoicePaymentFailed,
    },
  });

  // Plugin extension-point. Provider-Plugins registrieren sich hier.
  r.extendsRegistrar(SUBSCRIPTION_PROVIDER_EXTENSION, {
    onRegister: () => {
      // No side-effects at register-time.
    },
  });

  // Custom write-handlers:
  //   - process-event: programmatic entry-point vom webhook-handler;
  //     dispatcht zu type-passendem appendEvent
  //   - create-checkout-session: Tenant-Admin "Upgrade to Pro"-flow
  //   - create-portal-session: Tenant-Admin "Manage Subscription"-flow
  r.writeHandler(processEventHandler);
  r.writeHandler(createCheckoutSessionHandler);
  r.writeHandler(createPortalSessionHandler);

  // Custom list-query auf der subscription-projection (raw drizzle-
  // table; kein r.entity weil Schreiben via projection-apply läuft).
  r.queryHandler(listSubscriptionsQuery);
});
