import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for tag-assignment aggregate-id derivation. Generated
// once (2026-06-18), frozen: changing it would re-key every existing assignment
// stream → broken replay. Drift-pinned in __tests__.
const TAG_ASSIGNMENT_NAMESPACE = "a7f3c9d2-1b4e-4c8a-9f6d-2e5b8a1c3f7d";

/**
 * Deterministic aggregate-id for a tag-assignment from the tuple
 * (tenantId, tagId, entityType, entityId). Exactly one aggregate exists per
 * (tenant, tag, entity), so assigning the same tag twice collides on the same
 * stream → version_conflict instead of a duplicate row. The assign handler
 * pre-checks existence to keep re-assign idempotent (TX-safe).
 */
// @wrapper-known uuid-domain
export function tagAssignmentAggregateId(
  tenantId: string,
  tagId: string,
  entityType: string,
  entityId: string,
): string {
  return uuidv5(`${tenantId}|${tagId}|${entityType}|${entityId}`, TAG_ASSIGNMENT_NAMESPACE);
}
