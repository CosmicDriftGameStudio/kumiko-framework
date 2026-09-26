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
//   5. **createSubscriptionWebhookRoute**: factory for the `entry:"signature"`
//      extraRoute `/api/subscription/webhook/:providerName`.
//   6. **payment-received event + read_payments projection**: one-off-
//      payments (checkout mode "payment") get their own event, own
//      per-tenant aggregate, and own `process-payment-event` write-handler
//      — not a sixth SubscriptionEventTypes value (fw#2791).
//   7. **Optional billing-plans catalog** (`createBillingFoundationFeature({
//      baseUrl, catalog })`): a `billing-foundation:query:billing-plans`
//      query plus `start-plan-checkout`/`switch-plan` write-handlers and a
//      dormant `billing-plans` dashboard screen/panel, all derived from the
//      one `catalog` option — no separate per-app price wiring.
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

import {
  defineFeature,
  EXT_TENANT_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { BILLING_FOUNDATION_FEATURE, SUBSCRIPTION_PROVIDER_EXTENSION } from "./constants";
import { paymentEntity, subscriptionEntity } from "./entities";
import {
  INVOICE_PAID_EVENT_QN,
  INVOICE_PAID_EVENT_SHORT,
  INVOICE_PAYMENT_FAILED_EVENT_QN,
  INVOICE_PAYMENT_FAILED_EVENT_SHORT,
  PAYMENT_AGGREGATE_TYPE,
  PAYMENT_RECEIVED_EVENT_QN,
  PAYMENT_RECEIVED_EVENT_SHORT,
  paymentEventPayloadSchema,
  SUBSCRIPTION_AGGREGATE_TYPE,
  SUBSCRIPTION_CANCELED_EVENT_QN,
  SUBSCRIPTION_CANCELED_EVENT_SHORT,
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_SHORT,
  SUBSCRIPTION_UPDATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_SHORT,
  subscriptionEventPayloadSchema,
} from "./events";
import { createBillingPlansQuery } from "./handlers/billing-plans.query";
import { createCheckoutSessionHandler } from "./handlers/create-checkout-session.write";
import { createPortalSessionHandler } from "./handlers/create-portal-session.write";
import { listSubscriptionsQuery } from "./handlers/list-subscriptions.query";
import { processEventHandler } from "./handlers/process-event.write";
import { processPaymentEventHandler } from "./handlers/process-payment-event.write";
import { createStartPlanCheckoutHandler } from "./handlers/start-plan-checkout.write";
import { createSwitchPlanHandler } from "./handlers/switch-plan.write";
import { BILLING_FOUNDATION_I18N } from "./i18n";
import {
  applyInvoicePaid,
  applyInvoicePaymentFailed,
  applyPaymentReceived,
  applySubscriptionCanceled,
  applySubscriptionCreated,
  applySubscriptionUpdated,
  paymentsProjectionTable,
  subscriptionsProjectionTable,
} from "./projection";
import { createBillingPlansScreen } from "./screens";
import {
  PAYMENT_TENANT_DESTROY_ARCHIVE_REASON,
  paymentTenantDestroyHook,
  SUBSCRIPTION_TENANT_DESTROY_ARCHIVE_REASON,
  subscriptionTenantDestroyHook,
} from "./tenant-destroy-hook";
import type { BillingFoundationOptions } from "./types";

function isRootRelativePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/** Validates `options` and throws a plain `Error` with a clear message at
 *  feature-definition time — same pattern as `createCapOverviewFeature`.
 *  `createBillingFoundationFeature()` (no options) always succeeds; the
 *  extra checks only fire once a caller opts into `baseUrl`/`catalog`. */
function validateOptions(options: BillingFoundationOptions): void {
  if (options.baseUrl !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(options.baseUrl);
    } catch {
      throw new Error(
        `createBillingFoundationFeature: baseUrl "${options.baseUrl}" is not a parseable absolute URL.`,
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `createBillingFoundationFeature: baseUrl "${options.baseUrl}" must use http or https (parsed protocol "${parsed.protocol}").`,
      );
    }
  }
  const { catalog } = options;
  // skip: no catalog configured, nothing more to validate.
  if (!catalog) return;
  if (options.baseUrl === undefined) {
    throw new Error(
      "createBillingFoundationFeature: catalog requires baseUrl (plan checkouts need it to build success/cancel/return URLs).",
    );
  }
  if (catalog.plans.length === 0) {
    throw new Error("createBillingFoundationFeature: catalog.plans must not be empty.");
  }
  const seen = new Set<string>();
  for (const tier of catalog.plans) {
    if (seen.has(tier)) {
      throw new Error(
        `createBillingFoundationFeature: catalog.plans has a duplicate tier "${tier}".`,
      );
    }
    seen.add(tier);
  }
  for (const [key, path] of [
    ["successPath", catalog.successPath],
    ["cancelPath", catalog.cancelPath],
    ["returnPath", catalog.returnPath],
  ] as const) {
    if (path !== undefined && !isRootRelativePath(path)) {
      throw new Error(
        `createBillingFoundationFeature: catalog.${key} "${path}" must start with "/" and not "//".`,
      );
    }
  }
  if (catalog.viewRoles.length === 0) {
    throw new Error("createBillingFoundationFeature: catalog.viewRoles must not be empty.");
  }
}

export function createBillingFoundationFeature<TTier extends string = string>(
  options: BillingFoundationOptions<TTier> = {},
): FeatureDefinition {
  validateOptions(options);
  // Handlers take the widened, string-tiered options — `TTier` only exists
  // to let app-callers write `catalog.plans` as a literal-tier tuple; the
  // foundation itself treats every tier as an opaque string. This object
  // literal (not a cast) only compiles because `BillingFoundationOptions
  // <TTier>` uses `TTier` solely in readonly-array/Record-value positions.
  // baseUrl is normalized once here (trailing "/" stripped) so every
  // downstream string-concatenation site (checkout-core's joinBaseUrl, the
  // plan-checkout/switch-plan handlers) can rely on a single canonical form
  // instead of re-normalizing per call-site.
  const widened: BillingFoundationOptions = {
    ...options,
    ...(options.baseUrl !== undefined && {
      baseUrl: options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl,
    }),
  };

  return defineFeature(BILLING_FOUNDATION_FEATURE, (r) => {
    r.describe(
      "Plugin host for subscription billing — manages the `read_subscriptions` projection table and exposes 5 domain events (subscription created/updated/canceled, invoice paid/failed) appended by the foundation's own `billing-foundation:write:process-event` write-handler after provider plugins verify and normalize each webhook. Also manages a separate `read_payments` projection table (one row per one-off-payment) fed by its own `payment-received` event and `billing-foundation:write:process-payment-event` write-handler. Also ships `billing-foundation:write:create-checkout-session` and `billing-foundation:write:create-portal-session` write-handlers, a `billing-foundation:query:subscription:list` query handler, and a `createSubscriptionWebhookRoute` factory for the `/api/subscription/webhook/:providerName` extraRoute. `createBillingFoundationFeature({ baseUrl, catalog })` additionally derives a `billing-foundation:query:billing-plans` query, `start-plan-checkout`/`switch-plan` write-handlers and a dormant billing-plans dashboard screen/panel from the catalog. Low-level building block — use `subscription-stripe` or `subscription-mollie` unless you are writing a new payment provider.",
    );
    r.uiHints({
      displayLabel: "Billing · Foundation",
      category: "billing",
      recommended: false,
    });
    r.requires("tenant-lifecycle", "compliance-profiles");
    // 5 fine-grained domain-events. Alle 5 nutzen denselben payload-
    // shape (= subscription-state-snapshot); der event-type taggt was
    // passiert ist. Future-consumer (billing-history, accounting)
    // listenen direkt auf den event-type ohne payload-discriminator.
    // piiFields: "none" — provider ids are tenantOwned ciphertext, not plaintext personal data.
    r.defineEvent(SUBSCRIPTION_CREATED_EVENT_SHORT, subscriptionEventPayloadSchema, {
      piiFields: "none",
    });
    r.defineEvent(SUBSCRIPTION_UPDATED_EVENT_SHORT, subscriptionEventPayloadSchema, {
      piiFields: "none",
    });
    r.defineEvent(SUBSCRIPTION_CANCELED_EVENT_SHORT, subscriptionEventPayloadSchema, {
      piiFields: "none",
    });
    r.defineEvent(INVOICE_PAID_EVENT_SHORT, subscriptionEventPayloadSchema, { piiFields: "none" });
    r.defineEvent(INVOICE_PAYMENT_FAILED_EVENT_SHORT, subscriptionEventPayloadSchema, {
      piiFields: "none",
    });
    // Own event, own aggregate-type — a one-off-payment is not a subscription
    // state transition. piiFields: "none" for the same reason as the 5 above:
    // providerCustomerId is tenantOwned ciphertext, not plaintext personal data.
    r.defineEvent(PAYMENT_RECEIVED_EVENT_SHORT, paymentEventPayloadSchema, { piiFields: "none" });

    // Inline projection: materialized current state in `read_subscriptions`.
    // Apply läuft in derselben TX wie ctx.unsafeAppendEvent — read-your-
    // own-write ohne dispatcher-tick.
    r.projection({
      name: "subscription",
      source: SUBSCRIPTION_AGGREGATE_TYPE,
      table: subscriptionsProjectionTable,
      entity: subscriptionEntity,
      apply: {
        [SUBSCRIPTION_CREATED_EVENT_QN]: applySubscriptionCreated,
        [SUBSCRIPTION_UPDATED_EVENT_QN]: applySubscriptionUpdated,
        [SUBSCRIPTION_CANCELED_EVENT_QN]: applySubscriptionCanceled,
        [INVOICE_PAID_EVENT_QN]: applyInvoicePaid,
        [INVOICE_PAYMENT_FAILED_EVENT_QN]: applyInvoicePaymentFailed,
      },
    });

    // Second inline projection: `read_payments`, one row per one-off-payment.
    r.projection({
      name: "payment",
      source: PAYMENT_AGGREGATE_TYPE,
      table: paymentsProjectionTable,
      entity: paymentEntity,
      apply: {
        [PAYMENT_RECEIVED_EVENT_QN]: applyPaymentReceived,
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
    //   - create-checkout-session: bare priceId-driven checkout (hardened,
    //     see checkout-core)
    //   - create-portal-session: Tenant-Admin "Manage Subscription"-flow
    r.writeHandler(processEventHandler);
    r.writeHandler(createCheckoutSessionHandler(widened));
    r.writeHandler(createPortalSessionHandler(widened));
    //   - process-payment-event: programmatic entry-point from the webhook-
    //     handler for one-off-payments; appends onto the payment-aggregate
    r.writeHandler(processPaymentEventHandler);

    // Custom list-query auf der subscription-projection (raw drizzle-
    // table; kein r.entity weil Schreiben via projection-apply läuft).
    r.queryHandler(listSubscriptionsQuery);

    // Error-keys from checkout-core (redirect-origin, unknown-price, ...)
    // fire from create-checkout-session even without a catalog — register
    // unconditionally rather than splitting the i18n surface by option.
    r.translations({ keys: BILLING_FOUNDATION_I18N });

    if (widened.catalog) {
      const { catalog } = widened;
      r.queryHandler(createBillingPlansQuery(catalog));
      r.writeHandler(createStartPlanCheckoutHandler(widened, catalog));
      r.writeHandler(createSwitchPlanHandler(widened, catalog));
      r.screen(createBillingPlansScreen(catalog.viewRoles));
    }

    r.useExtension(EXT_TENANT_DATA, "subscription", {
      destroy: subscriptionTenantDestroyHook,
      escapeHatch: { reason: SUBSCRIPTION_TENANT_DESTROY_ARCHIVE_REASON },
    });
    r.useExtension(EXT_TENANT_DATA, "payment", {
      destroy: paymentTenantDestroyHook,
      escapeHatch: { reason: PAYMENT_TENANT_DESTROY_ARCHIVE_REASON },
    });
  });
}

// Back-compat: existing consumers importing the plain const keep working
// unchanged (no baseUrl/catalog — create-checkout-session's redirect-origin
// check then rejects every call as UnconfiguredError, matching the
// changes.json migration note).
export const billingFoundationFeature = createBillingFoundationFeature();
