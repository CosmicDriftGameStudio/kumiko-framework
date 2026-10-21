import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for deterministic aggregate-id derivation.
// Generated once and immutable: changing it would re-key every existing
// aggregate stream, breaking subscription state and audit history. The drift
// pin in __tests__/feature.test.ts locks the UUID.

/** Exactly one subscription aggregate exists per platform tenant. */
const SUBSCRIPTION_NAMESPACE = "5c3b2d1e-9a4f-4e8c-b7a3-1f8d6c2e9a4b";

/** Exactly ONE payment-aggregate-stream exists per platform tenant (it
 *  collects many payment-received events — one stream per tenant, not one
 *  per payment). Generated 2026-09-11, likewise set in stone. */
const PAYMENT_NAMESPACE = "dec0b897-646d-4da3-be3c-e9a35a83f4e0";

/** Namespace for deriving a `read_payments` row-id (PK) from
 *  `(tenantId, providerName, providerEventId)` — see `paymentRowId` below.
 *  StoredEvent.id is a bigserial (global chronological sequence), not a
 *  UUID, so it can't back a uuid-typed PK. Generated 2026-09-11, set in
 *  stone (same rationale as the two namespaces above). */
const PAYMENT_ROW_NAMESPACE = "3a1c9f4e-6b2d-4c8a-9e5f-7d4b1a2c8e6f";

/** Namespace for the system-tenant stream of an unmatched termination
 *  declaration (one stream per request). Generated 2026-10-03, set in stone. */
const TERMINATION_UNMATCHED_NAMESPACE = "7e2f4b9a-3c1d-4a68-8d05-b6c9e1f27a34";

/**
 * Deterministic aggregate ID for a platform tenant's subscription. Exactly
 * one subscription exists per tenant; add-ons are line items in that
 * subscription, not separate aggregates. A provider change, such as a
 * Stripe→Mollie migration, appends a new event to the same stream because
 * the tenant and aggregate stream remain the same.
 */
// @wrapper-known uuid-domain
export function subscriptionAggregateId(tenantId: string): string {
  return uuidv5(tenantId, SUBSCRIPTION_NAMESPACE);
}

/**
 * Deterministic aggregate-id for a platform tenant's payment-stream. A
 * tenant can make arbitrarily many one-off-payments — all land as
 * payment-received events on the same stream (like the subscription-
 * stream); the read_payments-projection creates its own row per event
 * (PK = paymentRowId(...), not aggregateId).
 */
// @wrapper-known uuid-domain
export function paymentAggregateId(tenantId: string): string {
  return uuidv5(tenantId, PAYMENT_NAMESPACE);
}

/** Deterministic `read_payments` row-id — keyed off `(tenantId, providerName,
 *  providerEventId)` rather than the event-store's bigserial `event.id` (not
 *  a UUID) or the shared per-tenant aggregateId (one row per payment). */
// @wrapper-known uuid-domain
export function paymentRowId(
  tenantId: string,
  providerName: string,
  providerEventId: string,
): string {
  // tenantId is part of the key because the idempotency scan in
  // process-payment-event.write.ts is per-tenant: two tenants can
  // legitimately see the same providerEventId (multiple Stripe accounts,
  // test/prod mix) — without it, the second tenant's INSERT would silently
  // no-op (ON CONFLICT DO NOTHING) against the first tenant's row, losing
  // the payment with no error anywhere.
  return uuidv5(`${tenantId}:${providerName}:${providerEventId}`, PAYMENT_ROW_NAMESPACE);
}

/** Stream id of one unmatched termination declaration, derived from its request id. */
// @wrapper-known uuid-domain
export function terminationUnmatchedAggregateId(requestId: string): string {
  return uuidv5(requestId, TERMINATION_UNMATCHED_NAMESPACE);
}
