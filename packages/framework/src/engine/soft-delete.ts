import type { EntityDefinition } from "./types";

/**
 * Determine if an entity uses soft delete.
 * Entity-level setting overrides the global default.
 */
export function isSoftDeleteEnabled(
  entity: EntityDefinition,
  globalDefault: boolean,
): boolean {
  return entity.softDelete ?? globalDefault;
}

/**
 * Field names automatically added to soft-delete entities at the DB layer.
 */
export const SOFT_DELETE_FIELDS = {
  isDeleted: "isDeleted",
  deletedAt: "deletedAt",
  deletedById: "deletedById",
} as const;
