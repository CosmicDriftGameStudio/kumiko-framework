import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for folder-assignment aggregate-id derivation. Frozen:
// changing it would re-key every existing assignment stream → broken replay.
// Drift-pinned in __tests__.
const FOLDER_ASSIGNMENT_NAMESPACE = "b2e1f4a7-3c9d-4e8b-a1f6-5d2c8b3e7a9f";

/**
 * Deterministic aggregate-id for a folder-assignment from the tuple
 * (tenantId, entityType, entityId) — note: NO folderId. Exactly one aggregate
 * exists per (tenant, entity), so an entity belongs to at most one folder;
 * re-assigning to a different folder updates the same stream (move) instead of
 * creating a second row. This is the single-membership counterpart to tags'
 * many-to-many aggregate-id (which includes the tagId).
 */
// @wrapper-known uuid-domain
export function folderAssignmentAggregateId(
  tenantId: string,
  entityType: string,
  entityId: string,
): string {
  return uuidv5(`${tenantId}|${entityType}|${entityId}`, FOLDER_ASSIGNMENT_NAMESPACE);
}
