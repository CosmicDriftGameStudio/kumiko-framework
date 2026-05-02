import { v5 as uuidv5 } from "uuid";

// Fixed UUID-namespace für die cap-counter-aggregate-id-Ableitung.
// Generiert einmalig (2026-05-02), in Stein gemeißelt: ein Wechsel würde
// jeden existing aggregate-Stream re-keyen → kaputter event-replay,
// kaputte counter-history, verlorener Audit-Trail. Drift-Pin in
// __tests__/drift.test.ts pinnt den UUID-Wert.
const CAP_COUNTER_NAMESPACE = "9c1bf2a3-6e4d-4f5b-8a9c-2d3e4f5a6b7c";

/**
 * Deterministic aggregate-id für ein cap-counter-Aggregate aus dem
 * Tripel (tenantId, capName, periodStart-as-iso). Pro Tenant + Cap +
 * Period existiert genau ein Aggregate.
 *
 * **Period-Semantik:**
 *   - Calendar-Month-Reset: neuer periodStart am 1. des Monats →
 *     neuer Aggregate-Stream. Vorherige Counter-Row bleibt für Audit.
 *   - Rolling-Window: periodStart wird NIE zurückgesetzt (z.B. fixed
 *     "1970-01-01" als Sentinel). Der Read filtert via Event-Store-
 *     Timestamp, nicht via Aggregate-Identity.
 *
 * **Aufruf-Pattern:** Caller (incrementCap-Helper) ruft das mit dem
 * tenantId aus event.user.tenantId, dem capName und dem aktuellen
 * Period-Start auf. Race-frei: zwei parallele Increments für denselben
 * (tenant, cap, period) gehen auf denselben aggregate-Stream und werden
 * vom event-store optimistic-lock serialisiert (version_conflict bei
 * Race → Caller-side Retry).
 */
export function capCounterAggregateId(
  tenantId: string,
  capName: string,
  periodStartIso: string,
): string {
  return uuidv5(`${tenantId}|${capName}|${periodStartIso}`, CAP_COUNTER_NAMESPACE);
}
