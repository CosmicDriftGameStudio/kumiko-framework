import {
  createEntity,
  createLongTextField,
  createTextField,
  createTimestampField,
} from "@kumiko/framework/engine";

// =============================================================================
// `subscription` — current state pro Plattform-Tenant
// =============================================================================
//
// EINE Row pro Plattform-Tenant. Aggregate-ID ist deterministic =
// uuidv5(SUBSCRIPTION_NAMESPACE, tenantId), damit Webhook-Replays
// (Stripe sendet bei Hängern bis zu 5x in 4h) auf denselben Stream
// schreiben statt zwei Rows zu erzeugen.
//
// **Was hier IST:**
//   - providerName: "stripe" / "mollie" — welcher Provider die
//     Subscription hält. Wechsel = neue subscription-Row mit anderer
//     providerName (theoretisch — Migration zwischen Providern ist
//     ein Sonderfall, nicht im Sprint-5-Scope).
//   - providerCustomerId / providerSubscriptionId: provider-eigene
//     IDs. Werden für Tenant-Resolution beim Webhook-Lookup gebraucht.
//   - status: active / past_due / canceled / trialing / incomplete —
//     normalisiert über provider-grenzen hinweg.
//   - tier: "free" / "pro" / ... — den der tier-engine konsumiert.
//     Wird aus price-to-tier-Map resolved.
//   - currentPeriodEnd: wann läuft die aktuelle Billing-Period aus.
//     Display-Zweck (Tenant-Admin sieht "Ihr Pro-Plan endet am ...").
//
// **Was hier NICHT ist:**
//   - invoice-history, payment-method, line-items, tax-info → all das
//     fetcht der Tenant via customer-portal-session direkt vom Provider.
//     Kumiko speichert nur den minimalen state den der tier-engine
//     für Mount-Decisions braucht.
//   - cancelAt, cancelAtPeriodEnd → Provider-Sache, der Webhook
//     liefert beim period-end den canceled-Event.
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

// =============================================================================
// `subscription-event` — Audit + Idempotency-Anker
// =============================================================================
//
// Eine Row pro empfangenem Provider-Webhook-Event. Der UNIQUE-Constraint
// auf (tenantId, providerName, providerEventId) verhindert dass derselbe
// Stripe-Event zweimal verarbeitet wird (Stripe-Retry-Storm).
//
// Audit-Use: Operator kann `WHERE tenantId=X` filtern + chronologisch
// sehen was der Provider geliefert hat. Replay-Use: wenn der state-update-
// handler buggy war, kann der raw-payload-Spalte erneut durchgewalkt
// werden ohne nochmal beim Provider anzufragen.
//
// Aggregate-ID = uuidv5(SUBSCRIPTION_EVENT_NAMESPACE, tenantId|provider|
// providerEventId) damit auch der event-store-Aggregate-Stream pro
// (tenant, event) eindeutig + idempotent ist. Memory `feedback_alles_ist_
// ein_feature` — kein separates webhook-replay-System.
//
// **Felder:**
//   - providerName: "stripe" / "mollie"
//   - providerEventId: provider-event-id (Stripe: "evt_...", Mollie:
//     payment-id oder subscription-id je nach event-type)
//   - eventType: normalisierter Type ("subscription.created" / ...)
//   - receivedAt: server-side timestamp wann der webhook ankam (nicht
//     der provider-timestamp — der ist im rawPayload)
//   - rawPayload: provider-event-Body 1:1 archiviert (als JSON-string).
//     Bei Plugin-Schema-Änderung kann ein Re-Apply die alten events
//     mit dem neuen Mapping verarbeiten.
//
// **Kein processedAt-Feld**: insert-event + upsert-subscription laufen
// in derselben dispatcher-Transaktion, ein System-Crash würde beide
// rollbacken. "received but unprocessed" ist damit kein erreichbarer
// Zustand. Falls Audit später eine "wann wurde das event-mapping
// durchgeführt"-Ansicht braucht: receivedAt = wann webhook ankam,
// event-store-event-timestamp = wann der Insert committed wurde,
// das deckt's ab.
export const subscriptionEventEntity = createEntity({
  table: "read_subscription_events",
  fields: {
    providerName: createTextField({ required: true, maxLength: 50 }),
    providerEventId: createTextField({ required: true, maxLength: 200 }),
    eventType: createTextField({ required: true, maxLength: 100 }),
    receivedAt: createTimestampField({ required: true }),
    // rawPayload als longText — Stripe-events mit vielen line-items +
    // metadata können hunderte KB groß sein, ein varchar-cap würde
    // willkürlich daten verlieren. longText mapped auf Postgres TEXT
    // (= unbegrenzt). Plugin serialisiert auf seiner Seite, foundation
    // archiviert den string. Trade-off: kein DB-side query auf payload
    // möglich — akzeptabel weil rawPayload primär audit/replay ist.
    rawPayload: createLongTextField({ required: true }),
  },
});

// Drift-Pin: Counter im sample-app sieht nur das Schema, nicht die
// dahinter liegenden constants. Wenn jemand die Field-Names ändert,
// fallen die integration-tests auf indem die `read_subscriptions`-
// Spalten anders heißen. Tabellen-Namen sind explizit — der Default
// `subscriptions` würde mit anderen Apps kollidieren wenn die selbe
// DB. Prefix `read_` markiert es als read-side projection.
