import { v5 as uuidv5 } from "uuid";

// Fixed UUID-namespace für die tier-assignment-aggregate-id-Ableitung.
// Generiert einmalig (2026-05-02), in Stein gemeißelt: ein Wechsel würde
// jeden existing aggregate-Stream re-keyen → kaputter event-replay,
// kaputte projection-rebuilds, verlorener Tier-Wechsel-Audit. Der
// drift-pin-Test in feature.test.ts pinnt diese Konstante.
const TIER_ASSIGNMENT_NAMESPACE = "8e91d2fc-8b7a-4d3e-9f4a-1c5d6e7f8a9b";

/**
 * Deterministic aggregate-id für ein Tier-Assignment aus dem tenantId.
 * Pro Plattform-Tenant existiert genau ein Aggregat — uuidv5 ist
 * namespace-deterministic, identische Eingabe ergibt identischen UUID.
 *
 * **Wann nutzen:** Sprint 5 (`stripe-sync`-Feature) wrapt einen
 * idempotent-set-tier-Handler darum: zweiter Stripe-Webhook-Retry mit
 * derselben tenantId → derselbe aggregate-Stream → version_conflict
 * vom Event-Store statt pg-23505 von der Read-Model-DB. ES-saubere
 * Path-Uniqueness statt DB-Constraint.
 *
 * **Sprint 1 nutzt das nicht aktiv** — Standard-CRUD-Handlers vergeben
 * UUID via `gen_random_uuid()`. Die Funktion lebt hier als Utility-
 * Export bereit für Sprint 5.
 */
// @wrapper-known uuid-domain
export function tierAssignmentAggregateId(tenantId: string): string {
  return uuidv5(tenantId, TIER_ASSIGNMENT_NAMESPACE);
}
