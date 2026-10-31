import type { Registry } from "../engine/types/index.ts";

export function isEntitySearchable(registry: Registry, entityName: string): boolean {
  return (
    registry.getSearchableFields(entityName).length > 0 ||
    registry.getSearchPayloadExtensions(entityName).length > 0
  );
}
