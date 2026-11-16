import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for deriving cap-counter aggregate IDs.
// Generated once (2026-05-02) and immutable: changing it would re-key every
// existing aggregate stream, breaking event replay and counter history and
// losing the audit trail. __tests__/enforce-cap.test.ts pins the UUID.
const CAP_COUNTER_NAMESPACE = "9c1bf2a3-6e4d-4f5b-8a9c-2d3e4f5a6b7c";

/**
 * One aggregate per (tenantId, capName, periodStart-as-iso). A new calendar
 * period yields a new stream, so the previous counter row stays for audit.
 * Parallel bookings for the same triple share one stream; the event store's
 * optimistic lock serializes them and bookCapUsage retries the loser.
 */
export function capCounterAggregateId(
  tenantId: string,
  capName: string,
  periodStartIso: string,
): string {
  return uuidv5(`${tenantId}|${capName}|${periodStartIso}`, CAP_COUNTER_NAMESPACE);
}
