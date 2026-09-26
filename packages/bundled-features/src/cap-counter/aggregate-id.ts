import { v5 as uuidv5 } from "uuid";

// Fixed UUID-namespace für die cap-counter-aggregate-id-Ableitung.
// Generiert einmalig (2026-05-02), in Stein gemeißelt: ein Wechsel würde
// jeden existing aggregate-Stream re-keyen → kaputter event-replay,
// kaputte counter-history, verlorener Audit-Trail. Drift-Pin in
// __tests__/drift.test.ts pinnt den UUID-Wert.
const CAP_COUNTER_NAMESPACE = "9c1bf2a3-6e4d-4f5b-8a9c-2d3e4f5a6b7c";

// Separater Namespace für Rolling-Window-Counter (Sprint 4). Eigener
// Namespace damit das aggregate-id NIE mit einem Calendar-Counter
// kollidiert, selbst wenn jemand "1970-01-01..." als periodStart in
// den Calendar-Pfad reinpasst. Drift-Pin in __tests__/drift.test.ts.
const CAP_COUNTER_ROLLING_NAMESPACE = "8b2ad0c6-1f3e-4f7c-9b8a-3c4d5e6f7a8b";

/**
 * One aggregate per (tenantId, capName, periodStart-as-iso). A new calendar
 * period yields a new stream, so the previous counter row stays for audit.
 * Parallel bookings for the same triple share one stream; the event store's
 * optimistic lock serializes them and bookCapUsage retries the loser.
 */
// @wrapper-known uuid-domain
export function capCounterAggregateId(
  tenantId: string,
  capName: string,
  periodStartIso: string,
): string {
  return uuidv5(`${tenantId}|${capName}|${periodStartIso}`, CAP_COUNTER_NAMESPACE);
}

/**
 * Deterministic aggregate-id für ein Rolling-Window-Counter-Aggregate
 * aus dem Paar (tenantId, capName). Pro Tenant + Cap existiert genau
 * EIN Rolling-Aggregate-Stream — die Window-Semantik kommt rein aus
 * dem Read-Pfad (Filter via event-store-Timestamp).
 *
 * **Eigener Namespace:** kollidiert NICHT mit
 * `capCounterAggregateId(tenantId, capName, "1970-01-01...")` — selbe
 * inputs, andere uuidv5-namespace, anderer Output-UUID. Damit ist auch
 * verhindert dass ein versehentlicher Calendar-Increment auf den
 * Rolling-Stream trifft.
 *
 * **Aufruf-Pattern:** Caller (incrementRollingCap-Helper) ruft mit
 * tenantId + capName auf, erzeugt Increment-Events am stream. Race-
 * frei: der event-store hängt mit auto-incrementing version an.
 */
// @wrapper-known uuid-domain
export function rollingCapAggregateId(tenantId: string, capName: string): string {
  return uuidv5(`${tenantId}|${capName}`, CAP_COUNTER_ROLLING_NAMESPACE);
}
