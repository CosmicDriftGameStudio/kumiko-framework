import { v5 as uuidv5 } from "uuid";

// Fixed UUID-namespace für die deterministic aggregate-id-Ableitung.
// Generiert einmalig (2026-05-03), in Stein gemeißelt: ein Wechsel
// würde jeden existing aggregate-Stream re-keyen → kaputter
// Subscription-State, kaputte Audit-History. Drift-Pin in
// __tests__/feature.test.ts pinnt die UUID.

/** Pro Plattform-Tenant existiert genau EIN subscription-Aggregate. */
const SUBSCRIPTION_NAMESPACE = "5c3b2d1e-9a4f-4e8c-b7a3-1f8d6c2e9a4b";

/** Pro Plattform-Tenant existiert genau EIN payment-Aggregate-Stream (der
 *  viele payment-received-events sammelt — ein Stream pro Tenant, nicht
 *  einer pro Payment). Generiert 2026-09-11, ebenfalls in Stein gemeißelt. */
const PAYMENT_NAMESPACE = "dec0b897-646d-4da3-be3c-e9a35a83f4e0";

/** Namespace for deriving a `read_payments` row-id (PK) from
 *  `(tenantId, providerName, providerEventId)` — see `paymentRowId` below.
 *  StoredEvent.id is a bigserial (global chronological sequence), not a
 *  UUID, so it can't back a uuid-typed PK. Generated 2026-09-11, in Stein
 *  gemeißelt (same rationale as the two namespaces above). */
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
 * Deterministic aggregate-id für den payment-Stream eines Plattform-
 * Tenants. Ein Tenant kann beliebig viele one-off-payments machen — alle
 * landen als payment-received-events auf demselben Stream (analog zum
 * subscription-Stream), die read_payments-projection legt pro Event eine
 * eigene Row an (PK = paymentRowId(...), nicht aggregateId).
 */
// @wrapper-known uuid-domain
export function paymentAggregateId(tenantId: string): string {
  return uuidv5(tenantId, PAYMENT_NAMESPACE);
}

/**
 * Deterministic `read_payments` row-id, derived from
 * (tenantId, providerName, providerEventId) — not the event-store's
 * bigserial `event.id` (not a UUID) and not the shared per-tenant
 * aggregateId (one row per payment, not per stream). Deterministic so a
 * projection rebuild re-inserts the same PK instead of duplicating rows.
 * tenantId MUST be part of the key: the idempotency scan in
 * process-payment-event.write.ts is per-tenant (scoped to
 * paymentAggregateId(tenantId)), so two tenants can legitimately see the
 * same providerEventId (multiple Stripe accounts, test/prod mix) — without
 * tenantId in the key, the second tenant's INSERT would silently no-op
 * against the first tenant's row (ON CONFLICT DO NOTHING), losing the
 * payment with no error anywhere.
 */
// @wrapper-known uuid-domain
export function paymentRowId(
  tenantId: string,
  providerName: string,
  providerEventId: string,
): string {
  return uuidv5(`${tenantId}:${providerName}:${providerEventId}`, PAYMENT_ROW_NAMESPACE);
}
