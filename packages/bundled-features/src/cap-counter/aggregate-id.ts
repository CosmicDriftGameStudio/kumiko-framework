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
 * Deterministic aggregate id for a rolling-window counter, derived from
 * (tenantId, capName). Exactly ONE rolling aggregate stream exists per
 * tenant + cap; window semantics come purely from the read path
 * (filtering on the event-store timestamp), so no period is part of the id.
 *
 * **Separate namespace:** does NOT collide with
 * `capCounterAggregateId(tenantId, capName, "1970-01-01...")`. Same inputs,
 * different uuidv5 namespace, different output UUID. This also prevents an
 * accidental calendar increment from landing on the rolling stream.
 *
 * **Caller:** `CapCounterHandlers.incrementRolling` (via `ctx.write`) calls
 * this with tenantId + capName and appends increment events to the stream.
 * Race-free because the event store appends with an auto-incrementing version.
 */
// @wrapper-known uuid-domain
export function rollingCapAggregateId(tenantId: string, capName: string): string {
  return uuidv5(`${tenantId}|${capName}`, CAP_COUNTER_ROLLING_NAMESPACE);
}
