import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for deriving tier-assignment aggregate IDs.
// Generated once and immutable: changing it would re-key every existing
// aggregate stream, breaking event replay and projection rebuilds and losing
// the tier-change audit. The drift-pin test in feature.test.ts pins this constant.
const TIER_ASSIGNMENT_NAMESPACE = "8e91d2fc-8b7a-4d3e-9f4a-1c5d6e7f8a9b";

/**
 * Deterministic aggregate ID for a tier assignment derived from `tenantId`.
 * Each platform tenant has exactly one aggregate; uuidv5 is namespace-
 * deterministic, so identical input produces the same UUID.
 *
 * **When to use:** The `stripe-sync` feature wraps an idempotent
 * set-tier handler with this function: a second Stripe webhook retry for
 * the same `tenantId` targets the same aggregate stream, causing
 * `version_conflict` from the event store instead of `pg-23505` from the
 * read-model database. This enforces path uniqueness rather than a database
 * constraint.
 *
 * Standard CRUD handlers instead generate UUIDs via `gen_random_uuid()`.
 * This utility is exported for use by the `stripe-sync` feature.
 */
// @wrapper-known uuid-domain
export function tierAssignmentAggregateId(tenantId: string): string {
  return uuidv5(tenantId, TIER_ASSIGNMENT_NAMESPACE);
}
