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
//      "subscriptionProvider", ...)`. Provider-Plugins registrieren sich.
//   2. **2 Domain-Entitäten**:
//      - `subscription`: current state pro Plattform-Tenant (mit
//        providerName-Spalte = welcher Plugin gerade die Sub hält)
//      - `subscription-event`: audit + idempotency-anchor für webhooks
//   3. **process-event-handler**: programmatic write-handler den der
//      webhook-handler aufruft mit dem normalisierten Event vom Plugin
//   4. **createSubscriptionWebhookHandler**: factory für die HTTP-Route
//      `/api/subscription/webhook/:providerName` (Pfad-Parameter wählt
//      Plugin). App-Owner mountet via `extraRoutes` in seinem
//      bin/server.ts.
//
// **Was diese Foundation NICHT macht:**
//   - Kein Tier-Sync zum tier-engine. Das ist optional — App-Owner
//     verdrahtet den process-event-handler-success ggf. mit einem
//     post-write-hook der `tier-engine:write:upsert-tier-assignment`
//     ruft.
//   - Keine provider-spezifischen Configs (Stripe-Webhook-secret,
//     PayPal-API-key etc). Diese liegen im jeweiligen Provider-Plugin
//     analog mail-transport-smtp / file-provider-s3.
//   - Keine `price-to-tier`-Map auf foundation-Ebene — pro-Plugin, weil
//     Stripe-priceIds vs PayPal-plan-ids vs Apple-product-ids
//     unterschiedliche IDs sind. Jedes Plugin definiert seinen eigenen
//     `<plugin-name>:config:price-to-tier`-Key.
//   - Kein Marketplace-Use-Case (App-Tenant billed Endkunden via
//     Stripe Connect). Kommt als separate `marketplace-foundation` —
//     siehe docs/plans/architecture/subscription-foundation.md.
//
// **Pattern-Vorbild:** mirrors mail-foundation + file-foundation +
// ai-foundation. Identische Trennung Foundation ↔ Provider, aber
// MULTI-PROVIDER statt single-selector.

import {
  defineEntityListHandler,
  defineFeature,
  type FeatureDefinition,
} from "@kumiko/framework/engine";
import { SUBSCRIPTION_FOUNDATION_FEATURE, SUBSCRIPTION_PROVIDER_EXTENSION } from "./constants";
import { subscriptionEntity, subscriptionEventEntity } from "./entities";
import { processEventHandler } from "./handlers/process-event.write";

const sysadminAccess = { access: { roles: ["SystemAdmin"] } } as const;

export const subscriptionFoundationFeature: FeatureDefinition = defineFeature(
  SUBSCRIPTION_FOUNDATION_FEATURE,
  (r) => {
    // Domain-entities. Beide tenant-scoped (tenantId kommt automatisch
    // als Base-Column). r.entity registriert intern eine Implicit-
    // Projection — projection-rebuild wird via `kumiko project rebuild`
    // möglich falls die Mapping-Logik im handler je geändert wird.
    r.entity("subscription", subscriptionEntity);
    r.entity("subscription-event", subscriptionEventEntity);

    // Plugin extension-point. Provider-Plugins registrieren sich hier.
    // Der entityName beim r.useExtension wird Teil der webhook-URL
    // (`/api/subscription/webhook/:providerName`) und der
    // `subscription.providerName`-Spalte.
    r.extendsRegistrar(SUBSCRIPTION_PROVIDER_EXTENSION, {
      onRegister: () => {
        // No side-effects at register-time — Registry stores the usage,
        // webhook-handler-factory looks it up at request-time via
        // path-segment.
      },
    });

    // Custom write-handler — programmatic entry-point für webhook-handler.
    r.writeHandler(processEventHandler);

    // Standard reads — sysadmin-cross-tenant via list. Tenant-self-service-
    // queries (current subscription, available providers, ...) kommen mit
    // Phase 5.4 wenn das Sample erweitert wird.
    r.queryHandler(defineEntityListHandler("subscription", subscriptionEntity, sysadminAccess));
    r.queryHandler(
      defineEntityListHandler("subscription-event", subscriptionEventEntity, sysadminAccess),
    );
  },
);
