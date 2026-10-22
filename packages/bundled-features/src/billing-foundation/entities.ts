import { collectPiiSubjectFields } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
// `subscription` — current state per platform tenant (= read model)
// =============================================================================
//
// Inline projection target. Written by the `subscription` projection-
// apply (see feature.ts), NEVER directly by the handler. Source of truth is
// the event-store stream `subscription` with aggregate-id =
// uuidv5(SUBSCRIPTION_NAMESPACE, tenantId).
//
// ONE row per platform tenant. The aggregate ID is deterministic so that
// webhook replays (Stripe sends up to 5 times in 4 hours when delivery is
// stalled) write to the same stream instead of creating two rows.
//
// **Fields:**
//   - providerName: "stripe" / "mollie" — the provider holding the
//     subscription. A provider change is a new event on the same stream;
//     the projection overwrites the value.
//   - providerCustomerId / providerSubscriptionId: provider-specific IDs.
//   - status: active / past_due / canceled / trialing / incomplete —
//     normalized across providers.
//   - tier: "free" / "pro" / ... — consumed by the tier engine. Resolved
//     from the price-to-tier map in the plugin.
//   - currentPeriodEnd: when the current billing period ends.
//   - cancelAt: when a scheduled cancellation ends the subscription;
//     nullable because a renewing subscription has none.
//
// **Not included here:**
//   - invoice-history, payment-method, line-items, tax-info — the tenant
//     fetches all of these directly from the provider via a
//     customer-portal-session.
//
// **Audit/event history:** lives in the event store under the `subscription`
// stream — there is NO separate `subscription-event` table (= ES is the
// audit source of truth and can be replayed through upcasters).
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
    // eraseSubjectKeys erases the tenant's subject key on tenant-destroy.
    // `encrypted: true` uses the app-wide master key instead — that
    // key is never erased per-tenant, so it would only add encryption-at-
    // rest, not the erasure guarantee.
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
    tier: createTextField({
      required: true,
      maxLength: 50,
      personal: false,
      reason: "catalog_label",
    }),
    currentPeriodEnd: createTimestampField({ required: true }),
    cancelAt: createTimestampField({ required: false }),
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
    // crypto-shreds on tenant-destroy via eraseSubjectKeys.
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
