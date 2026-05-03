import { v5 as uuidv5 } from "uuid";

// Fixed UUID-namespaces für die deterministic aggregate-id-Ableitung.
// Generiert einmalig (2026-05-03), in Stein gemeißelt: ein Wechsel würde
// jeden existing aggregate-Stream re-keyen → kaputter Webhook-Replay,
// kaputte subscription-history. Drift-Pin in __tests__/feature.test.ts
// pinnt beide UUIDs.

/** Pro Plattform-Tenant existiert genau EIN subscription-Aggregate. */
const SUBSCRIPTION_NAMESPACE = "5c3b2d1e-9a4f-4e8c-b7a3-1f8d6c2e9a4b";

/** Pro empfangenem Provider-Event (tenantId, providerName, providerEventId)
 *  gibt's genau einen subscription-event-Aggregate. Stripe-Retry trifft
 *  denselben Stream → version_conflict beim Re-Insert → Idempotency. */
const SUBSCRIPTION_EVENT_NAMESPACE = "7e8a9b1c-3d4f-4a5b-9c6d-2e3f4a5b6c7d";

/**
 * Deterministic aggregate-id für die subscription eines Plattform-
 * Tenants. EINE Subscription pro Tenant (Add-Ons sind line-items in
 * derselben subscription, nicht eigene). Provider-Wechsel (z.B.
 * Stripe→Mollie-Migration) ändert die providerName-Spalte aber NICHT
 * die aggregate-id — selber Stream, selber Tenant.
 */
export function subscriptionAggregateId(tenantId: string): string {
  return uuidv5(tenantId, SUBSCRIPTION_NAMESPACE);
}

/**
 * Deterministic aggregate-id für ein einzelnes Webhook-Event. Stripe
 * sendet bei failed-delivery bis zu 5x in 4h denselben event mit
 * unverändertem `providerEventId`. Beim 2.+ Versuch:
 *   - dieselbe aggregate-id → existing aggregate-stream
 *   - version=0 (insertFirstEvent) wird vom event-store mit
 *     version_conflict abgelehnt
 *   - Foundation kann das als "schon verarbeitet" interpretieren
 *     und 200 OK zurückgeben (Stripe akzeptiert + stoppt retries)
 *
 * Das ist die Idempotency-Mechanik ohne separate dedup-Tabelle.
 */
export function subscriptionEventAggregateId(
  tenantId: string,
  providerName: string,
  providerEventId: string,
): string {
  return uuidv5(`${tenantId}|${providerName}|${providerEventId}`, SUBSCRIPTION_EVENT_NAMESPACE);
}
