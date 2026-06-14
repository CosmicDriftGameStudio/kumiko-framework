import { v5 as uuidv5 } from "uuid";

// Fixed UUID-namespace für die deterministic aggregate-id-Ableitung.
// Generiert einmalig (2026-05-03), in Stein gemeißelt: ein Wechsel
// würde jeden existing aggregate-Stream re-keyen → kaputter
// Subscription-State, kaputte Audit-History. Drift-Pin in
// __tests__/feature.test.ts pinnt die UUID.

/** Pro Plattform-Tenant existiert genau EIN subscription-Aggregate. */
const SUBSCRIPTION_NAMESPACE = "5c3b2d1e-9a4f-4e8c-b7a3-1f8d6c2e9a4b";

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
