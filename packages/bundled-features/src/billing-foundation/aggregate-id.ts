import { v5 as uuidv5 } from "uuid";

// Fixed UUID-namespace für die deterministic aggregate-id-Ableitung.
// Generiert einmalig (2026-05-03), in Stein gemeißelt: ein Wechsel
// würde jeden existing aggregate-Stream re-keyen → kaputter
// Subscription-State, kaputte Audit-History. Drift-Pin in
// __tests__/feature.test.ts pinnt die UUID.

/** Pro Plattform-Tenant existiert genau EIN subscription-Aggregate. */
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

/**
 * Deterministic aggregate-id für die subscription eines Plattform-
 * Tenants. EINE Subscription pro Tenant (Add-Ons sind line-items in
 * derselben subscription, nicht eigene). Provider-Wechsel (z.B.
 * Stripe→Mollie-Migration) appended einen neuen event auf denselben
 * Stream — selber Tenant, selber Aggregate-Stream.
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
