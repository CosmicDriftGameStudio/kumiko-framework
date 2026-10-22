// kumiko-feature-version: 1
//
// subscription-foundation as a Kumiko bundled feature (plugin host).
//
// **Multi-provider from day one** — the app builder can mount multiple plugins
// in parallel (subscription-stripe + subscription-paypal +
// subscription-apple-iap + ...), and the end user chooses between
// card/PayPal/Apple Pay/Klarna/SEPA at checkout (Disney+ pattern).
// There is no global `provider` config key — all mounted plugins are active.
//
// **What this foundation provides:**
//   1. **Plugin API** for subscription providers via `r.extendsRegistrar(
//      "subscriptionProvider", ...)`.
//   2. **5 domain events** on the `subscription` stream (one stream ID per
//      tenant): created/updated/canceled/invoice-paid/invoice-payment-failed.
//      Audit history is provided automatically by the event store.
//   3. **Inline projection** onto `read_subscriptions` (current state per
//      tenant). Apply runs in the same TX as the event append
//      → read-your-own-write semantics.
//   4. **process-event handler**: a programmatic write handler called by the
//      webhook handler that dispatches to the type-matched appendEvent.
//   5. **createSubscriptionWebhookRoute**: factory for the `entry:"signature"`
//      extraRoute `/api/subscription/webhook/:providerName`.
//   6. **payment-received event + read_payments projection**: one-off payments
//      (checkout mode "payment") get their own event, per-tenant aggregate,
//      and `process-payment-event` write handler — not a sixth
//      SubscriptionEventTypes value.
//   7. **Optional billing-plans catalog** (`createBillingFoundationFeature({
//      baseUrl, catalog })`): a `billing-foundation:query:billing-plans`
//      query plus `start-plan-checkout`/`switch-plan` write handlers and a
//      dormant `billing-plans` dashboard screen/panel, all derived from the
//      single `catalog` option — no separate per-app price wiring.
//
// **What this foundation does NOT do:**
//   - No r.entity for `subscription`. The table is a read-only projection —
//     there is no CRUD path. It is written exclusively via projection-apply,
//     triggered by one of the 5 events.
//   - No tier sync with tier-engine. App owners can read the subscription row
//     via `getSubscriptionForTenant(ctx, tenantId)` if needed.
//   - No provider-specific configs.
//   - No marketplace use case (the app tenant bills end customers via Stripe
//     Connect). That comes later as a separate `marketplace-foundation`.
//
// **Provider changes:** The Disney+ pattern (the tenant cancels a Stripe
// subscription and starts a new one with PayPal) is currently modeled as a
// second `subscription-created` event. UPSERT in projection-apply overwrites
// the existing row with the new providerName. This is sufficient for the MVP.
// If the business fact "provider change" needs its own domain event (for
// example, for analytics such as "how many changes per month?"), a
// `subscription-provider-changed` event type can be added later.

import {
  defineFeature,
  EXT_TENANT_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { registerConsumerProtection } from "./consumer-protection/register-consent.ts";
import { paymentEntity, subscriptionEntity } from "./entities.ts";
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
} from "./events.ts";
import { createBillingPlansQuery } from "./handlers/billing-plans.query.ts";
import { createCheckoutSessionHandler } from "./handlers/create-checkout-session.write.ts";
import { createPortalSessionHandler } from "./handlers/create-portal-session.write.ts";
import { listSubscriptionsQuery } from "./handlers/list-subscriptions.query.ts";
import { createPlanSwitchPreviewQuery } from "./handlers/plan-switch-preview.query.ts";
import { createProcessEventHandler } from "./handlers/process-event.write.ts";
import { processPaymentEventHandler } from "./handlers/process-payment-event.write.ts";
import { createStartPlanCheckoutHandler } from "./handlers/start-plan-checkout.write.ts";
import { createSwitchPlanHandler } from "./handlers/switch-plan.write.ts";
import { syncSubscriptionHandler } from "./handlers/sync-subscription.write.ts";
import { BILLING_FOUNDATION_I18N } from "./i18n.ts";
import {
  applyInvoicePaid,
  applyInvoicePaymentFailed,
  applyPaymentReceived,
  applySubscriptionCanceled,
  applySubscriptionCreated,
  applySubscriptionUpdated,
  paymentsProjectionTable,
  subscriptionsProjectionTable,
} from "./projection.ts";
import { createBillingPlansScreen } from "./screens.ts";
import {
  PAYMENT_TENANT_DESTROY_ARCHIVE_REASON,
  paymentTenantDestroyHook,
  SUBSCRIPTION_TENANT_DESTROY_ARCHIVE_REASON,
  subscriptionTenantDestroyHook,
} from "./tenant-destroy-hook.ts";
import type { BillingFoundationOptions, ResolvedBillingFoundationOptions } from "./types.ts";
import { validateOptions } from "./validate-options.ts";
import {
  BILLING_FOUNDATION_FEATURE,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  SubscriptionFoundationHandlers,
} from "./web/constants.ts";

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
  // instead of re-normalizing per call-site. `now` is defaulted once here
  // too — same pattern as createDekCache's `now` option — so no handler
  // ever calls `Temporal.Now.instant` itself.
  const widened: ResolvedBillingFoundationOptions = {
    ...options,
    now: options.now ?? (() => Temporal.Now.instant()),
    ...(options.baseUrl !== undefined && {
      baseUrl: options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl,
    }),
  };

  return defineFeature(
    BILLING_FOUNDATION_FEATURE,
    (r) => {
      r.describe(
        "Plugin host for subscription billing. Manages the `read_subscriptions` projection table and exposes 5 domain events (subscription created/updated/canceled, invoice paid/failed) appended by the foundation's own `billing-foundation:write:process-event` write-handler after provider plugins verify and normalize each webhook. Also manages a separate `read_payments` projection table (one row per one-off-payment) fed by its own `payment-received` event and `billing-foundation:write:process-payment-event` write-handler. Also ships `billing-foundation:write:create-checkout-session` and `billing-foundation:write:create-portal-session` write-handlers, a `billing-foundation:query:subscription:list` query handler, and a `createSubscriptionWebhookRoute` factory for the `/api/subscription/webhook/:providerName` extraRoute. `createBillingFoundationFeature({ baseUrl, catalog })` additionally derives a `billing-foundation:query:billing-plans` query, `start-plan-checkout`/`switch-plan` write-handlers, a `plan-switch-preview` query and a dormant billing-plans dashboard screen/panel from the catalog. Several providers can be mounted at once: new checkouts are offered by every enabled provider (enabled means keys set and billingLive on, or simply mounted for plugins without `isBillingEnabled`), the customer picks one in the plan panel and `start-plan-checkout` takes a `providerName`. An existing subscription stays with the provider that stored it, so the plan list and every switch follow that provider. A plan switch is either hosted (`createPlanSwitchSession` answers a url) or in-app (`previewPlanSwitch` shows the proration, `applyPlanSwitch` runs after the customer confirms; `switch-plan` then answers `{ applied: true }` and records the consent). `consumerProtection.providerTexts` overrides the checkout note and the VAT note per provider. Also ships `billing-foundation:write:sync-subscription` (pulls a provider plugin's live subscription state via `retrieveSubscription` and appends drift as a `subscription.updated` event, which catches changes made on the provider's own dashboard that never reached us as a webhook) and the `sync-subscriptions` job (manual-trigger + runOnBoot, perTenant) that dispatches it. Low-level building block: use `subscription-stripe`, `subscription-mollie` or `subscription-dodo` unless you are writing a new payment provider.",
      );
      r.uiHints({
        displayLabel: "Billing · Foundation",
        category: "billing",
        recommended: false,
      });
      r.requires({ features: ["tenant-lifecycle", "compliance-profiles"] });
      // 5 fine-grained domain-events. All 5 share the same payload shape (a
      // subscription-state snapshot); the event type tags what happened.
      // Future consumers (billing-history, accounting) listen directly on
      // the event type, no payload discriminator needed.
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
      r.defineEvent(INVOICE_PAID_EVENT_SHORT, subscriptionEventPayloadSchema, {
        piiFields: "none",
      });
      r.defineEvent(INVOICE_PAYMENT_FAILED_EVENT_SHORT, subscriptionEventPayloadSchema, {
        piiFields: "none",
      });
      // Own event, own aggregate-type — a one-off-payment is not a subscription
      // state transition. piiFields: "none" for the same reason as the 5 above:
      // providerCustomerId is tenantOwned ciphertext, not plaintext personal data.
      r.defineEvent(PAYMENT_RECEIVED_EVENT_SHORT, paymentEventPayloadSchema, { piiFields: "none" });

      // Inline projection: materialized current state in `read_subscriptions`.
      // Apply runs in the same TX as ctx.unsafeAppendEvent — read-your-own-
      // write without a dispatcher tick.
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

      // Plugin extension point. Provider plugins register here.
      r.extendsRegistrar(SUBSCRIPTION_PROVIDER_EXTENSION, {
        onRegister: () => {
          // No side-effects at register-time.
        },
      });

      // Custom write handlers:
      //   - process-event: programmatic entry point called by the webhook
      //     handler; dispatches to the type-matched appendEvent
      //   - create-checkout-session: bare priceId-driven checkout (hardened,
      //     see checkout-core)
      //   - create-portal-session: Tenant Admin "Manage Subscription" flow
      r.writeHandler(createProcessEventHandler(widened.now));
      r.writeHandler(createCheckoutSessionHandler(widened));
      r.writeHandler(createPortalSessionHandler(widened));
      //   - process-payment-event: programmatic entry-point from the webhook-
      //     handler for one-off-payments; appends onto the payment-aggregate
      r.writeHandler(processPaymentEventHandler);
      //   - sync-subscription: backfill entry-point for the sync-subscriptions
      //     job below; pulls the live provider state and appends drift as a
      //     subscription.updated event. Registered unconditionally (not
      //     catalog-gated) — it operates on whatever subscription already
      //     exists for the tenant, independent of the billing-plans catalog.
      r.writeHandler(syncSubscriptionHandler);

      // Custom list-query on the subscription-projection (raw drizzle
      // table; no r.entity since writes go through projection-apply).
      r.queryHandler(listSubscriptionsQuery);

      // Error-keys from checkout-core (redirect-origin, unknown-price, ...)
      // fire from create-checkout-session even without a catalog — register
      // unconditionally rather than splitting the i18n surface by option.
      r.translations({ keys: BILLING_FOUNDATION_I18N });
      if (widened.consumerProtection) {
        registerConsumerProtection(r, widened, widened.consumerProtection);
      }

      if (widened.catalog) {
        const { catalog } = widened;
        r.queryHandler(createBillingPlansQuery(widened, catalog));
        r.queryHandler(createPlanSwitchPreviewQuery(catalog));
        r.writeHandler(createStartPlanCheckoutHandler(widened, catalog));
        r.writeHandler(createSwitchPlanHandler(widened, catalog));
        r.screen(createBillingPlansScreen(catalog.viewRoles));
      }

      // Backfill job: catches provider-side drift (e.g. a cancel_at set on
      // the provider's own dashboard) that never reached us as a webhook.
      // manual-trigger + runOnBoot (not cron) — this is an on-demand/boot
      // reconciliation pass, not a recurring sweep; an app that wants a
      // recurring sync can dispatch billing-foundation:job:sync-subscriptions
      // from its own cron job. perTenant + runOnBoot are compatible (only
      // bootGate is not). Registered unconditionally, same reasoning as the
      // sync-subscription write-handler above.
      r.job({
        name: "sync-subscriptions",
        trigger: { manual: true },
        perTenant: true,
        runOnBoot: true,
        handler: async (_payload, ctx) => {
          const result = await ctx.write(SubscriptionFoundationHandlers.syncSubscription, {});
          if (!result.isSuccess) {
            throw new Error(
              `billing-foundation:sync-subscriptions: sync-subscription write failed: ${JSON.stringify(result.error)}`,
            );
          }
          ctx.log.info(`[billing-foundation:sync-subscriptions] ${JSON.stringify(result.data)}`);
        },
      });

      r.useExtension(EXT_TENANT_DATA, "subscription", {
        destroy: subscriptionTenantDestroyHook,
        escapeHatch: { reason: SUBSCRIPTION_TENANT_DESTROY_ARCHIVE_REASON },
      });
      r.useExtension(EXT_TENANT_DATA, "payment", {
        destroy: paymentTenantDestroyHook,
        escapeHatch: { reason: PAYMENT_TENANT_DESTROY_ARCHIVE_REASON },
      });
    },
    Object.keys(options).length === 0 ? { dedupeOptions: {} } : undefined,
  );
}
