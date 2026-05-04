import { createEntity, createTextField, createTimestampField } from "@kumiko/framework/engine";

// =============================================================================
// `subscription` — current state pro Plattform-Tenant (= Read-Model)
// =============================================================================
//
// Inline-Projection-Target. Geschrieben vom `subscription`-projection-
// apply (siehe feature.ts), NIE direkt vom handler. Source-of-truth ist
// der event-store stream `subscription` mit aggregate-id =
// uuidv5(SUBSCRIPTION_NAMESPACE, tenantId).
//
// EINE Row pro Plattform-Tenant. Aggregate-ID ist deterministic, damit
// Webhook-Replays (Stripe sendet bei Hängern bis zu 5x in 4h) auf
// denselben Stream schreiben statt zwei Rows zu erzeugen.
//
// **Felder:**
//   - providerName: "stripe" / "mollie" — welcher Provider die
//     Subscription hält. Provider-Wechsel = neuer event auf demselben
//     Stream, projection überschreibt.
//   - providerCustomerId / providerSubscriptionId: provider-eigene
//     IDs.
//   - status: active / past_due / canceled / trialing / incomplete —
//     normalisiert über provider-grenzen hinweg.
//   - tier: "free" / "pro" / ... — vom tier-engine konsumiert. Aus
//     price-to-tier-Map resolved im Plugin.
//   - currentPeriodEnd: wann läuft die aktuelle Billing-Period aus.
//
// **Was hier NICHT ist:**
//   - invoice-history, payment-method, line-items, tax-info → all das
//     fetcht der Tenant via customer-portal-session direkt vom Provider.
//   - cancelAt, cancelAtPeriodEnd → Provider-Sache.
//
// **Audit/event-history:** lebt im event-store unter dem `subscription`-
// stream — KEIN eigene `subscription-event`-Tabelle mehr (= ES ist die
// audit-truth, replay-fähig durch upcasters).
export const subscriptionEntity = createEntity({
  table: "read_subscriptions",
  fields: {
    providerName: createTextField({ required: true, maxLength: 50 }),
    providerCustomerId: createTextField({ required: true, maxLength: 200 }),
    providerSubscriptionId: createTextField({ required: true, maxLength: 200 }),
    status: createTextField({ required: true, maxLength: 30 }),
    tier: createTextField({ required: true, maxLength: 50 }),
    currentPeriodEnd: createTimestampField({ required: true }),
  },
});
