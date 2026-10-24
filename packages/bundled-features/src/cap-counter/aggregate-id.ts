import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for deriving cap-counter aggregate IDs.
// Generated once (2026-05-02) and immutable: changing it would re-key every
// existing aggregate stream, breaking event replay and counter history and
// losing the audit trail. The drift test in __tests__/drift.test.ts pins the UUID.
const CAP_COUNTER_NAMESPACE = "9c1bf2a3-6e4d-4f5b-8a9c-2d3e4f5a6b7c";

// Separate namespace for rolling-window counters. This prevents the aggregate ID
// from colliding with a calendar counter, even if "1970-01-01..." is passed as
// periodStart through the calendar path. The drift test in __tests__/drift.test.ts
// pins the UUID.
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
 * **Caller:** `CapCounterHandlers.incrementRolling` (via `ctx.dispatch.write`) calls
 * this with tenantId + capName and appends increment events to the stream.
 * Race-free because the event store appends with an auto-incrementing version.
 */
// @wrapper-known uuid-domain
export function rollingCapAggregateId(tenantId: string, capName: string): string {
  return uuidv5(`${tenantId}|${capName}`, CAP_COUNTER_ROLLING_NAMESPACE);
}
