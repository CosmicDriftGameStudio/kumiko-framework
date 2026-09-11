import { collectPiiSubjectFields } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
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
    providerName: createTextField({
      required: true,
      maxLength: 50,
      personal: false,
      reason: "technical_reference",
    }),
    // `personal: "tenant"` (not `encrypted`): the field must crypto-shred when
    // eraseSubjectKeys erases the tenant's subject key on tenant-destroy
    // (#800). `encrypted: true` uses the app-wide master key instead — that
    // key is never erased per-tenant, so it would only add encryption-at-
    // rest, not the erasure guarantee #800 actually asks for.
    // maxLength 1000, not 200: the stored value is PII-ciphertext
    // (`kumiko-pii:v1:<subject>:<blob>`), not the raw provider id — a
    // 200-char plaintext id becomes ~300+ chars of ciphertext. Matches
    // subscriptionEventPayloadSchema in events.ts.
    providerCustomerId: createTextField({
      required: true,
      maxLength: 1000,
      personal: "tenant",
      find: "none",
    }),
    providerSubscriptionId: createTextField({
      required: true,
      maxLength: 1000,
      personal: "tenant",
      find: "none",
    }),
    status: createTextField({
      required: true,
      maxLength: 30,
      personal: false,
      reason: "technical_reference",
    }),
    tier: createTextField({ required: true, maxLength: 50, personal: false, reason: "catalog_label" }),
    currentPeriodEnd: createTimestampField({ required: true }),
  },
});

// No executor manages this table (raw r.projection, see feature.ts) — the
// process-event write-handler and every read site must encrypt/decrypt
// these fields manually via the PII-subject-KMS path (same mechanism
// eraseSubjectKeys erases). Single source of truth so a future third
// `tenantOwned`/`pii`/`userOwned` field doesn't need a matching manual
// update at each call site.
export const SUBSCRIPTION_PII_FIELDS = collectPiiSubjectFields(subscriptionEntity);

// =============================================================================
// `payment` — one row per one-off-payment (= read-model)
// =============================================================================
//
// Inline-Projection-Target for the payment-received event (see feature.ts).
// Unlike subscriptionEntity (one row per tenant, UPSERTed), a tenant can have
// many payments — one INSERT-once row per event, PK = paymentRowId(...) (see
// projection.ts / aggregate-id.ts). Source-of-truth is the event-store stream `payment` with
// aggregate-id = paymentAggregateId(tenantId) — one stream per tenant
// collecting all of that tenant's payment-received events.
export const paymentEntity = createEntity({
  table: "read_payments",
  fields: {
    providerName: createTextField({
      required: true,
      maxLength: 50,
      personal: false,
      reason: "technical_reference",
    }),
    // Same `personal: "tenant"` rationale as subscriptionEntity above —
    // crypto-shreds on tenant-destroy (#800) via eraseSubjectKeys.
    providerCustomerId: createTextField({
      required: true,
      maxLength: 1000,
      personal: "tenant",
      find: "none",
    }),
    priceId: createTextField({
      required: true,
      maxLength: 200,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

// See the SUBSCRIPTION_PII_FIELDS comment above — same manual-wiring reason.
export const PAYMENT_PII_FIELDS = collectPiiSubjectFields(paymentEntity);
