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
    providerName: createTextField({ required: true, maxLength: 50 }),
    // tenantOwned (not `encrypted`): the field must crypto-shred when
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
      tenantOwned: true,
    }),
    providerSubscriptionId: createTextField({
      required: true,
      maxLength: 1000,
      tenantOwned: true,
    }),
    status: createTextField({ required: true, maxLength: 30 }),
    tier: createTextField({ required: true, maxLength: 50 }),
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
