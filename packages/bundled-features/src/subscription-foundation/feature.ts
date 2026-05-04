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

import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { SUBSCRIPTION_FOUNDATION_FEATURE, SUBSCRIPTION_PROVIDER_EXTENSION } from "./constants";
import { subscriptionEntity } from "./entities";
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

// Re-export entity-shape so external callers (helper, tests) can build
// their own drizzle-table-instance via buildDrizzleTable.
export { subscriptionEntity };

export const subscriptionFoundationFeature: FeatureDefinition = defineFeature(
  SUBSCRIPTION_FOUNDATION_FEATURE,
  (r) => {
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
    // Apply läuft in derselben TX wie ctx.appendEventUnsafe — read-your-
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
  },
);
