import { ENTITY_CONVENTION_QUERY_BRAND } from "@cosmicdrift/kumiko-types/handlers";
import { parseQn } from "./qualified-name.ts";
import type { EntityDefinition, QueryHandlerDef } from "./types/index.ts";

// Mirrors buildSearchableSortableCaches (registry-validate.ts): a `search`
// payload only matches text fields, embedded sub-fields and references that
// opted in with `searchable: true`.
function entityHasSearchableField(entity: EntityDefinition): boolean {
  return Object.values(entity.fields).some((field) => {
    if (field.type === "embedded") {
      return Object.values(field.schema).some((subField) => subField.searchable === true);
    }
    return (field.type === "text" || field.type === "reference") && field.searchable === true;
  });
}

// Entity-convention list queries (ENTITY_CONVENTION_QUERY_BRAND) carry no
// entity on the handler; the entity name is recovered from the query QN's
// `<entityName>:list` naming convention. Hand-written handlers resolve to
// undefined — "capability unknown, no throw".
export function resolveEntityBehindListQuery(
  queryQn: string,
  handler: QueryHandlerDef | undefined,
  lookupEntity: (entityName: string) => EntityDefinition | undefined,
): EntityDefinition | undefined {
  if (handler === undefined || handler[ENTITY_CONVENTION_QUERY_BRAND] !== true) return undefined;
  let entityName: string;
  try {
    entityName = parseQn(queryQn).name.split(":")[0] ?? "";
  } catch {
    return undefined;
  }
  return entityName === "" ? undefined : lookupEntity(entityName);
}

/** True when the list query is an entity-convention one over an entity with no
 *  searchable field — a search box would never match anything. */
export function isListQueryWithoutSearchableFields(
  queryQn: string,
  handler: QueryHandlerDef | undefined,
  lookupEntity: (entityName: string) => EntityDefinition | undefined,
): boolean {
  const entity = resolveEntityBehindListQuery(queryQn, handler, lookupEntity);
  return entity !== undefined && !entityHasSearchableField(entity);
}
