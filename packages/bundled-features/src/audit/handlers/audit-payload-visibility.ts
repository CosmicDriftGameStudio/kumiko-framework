// An audit event payload shows an entity's data, so it follows that entity's read rules:
// withheld (null) where the caller could not read the entity at all, stripped of the
// fields the caller could not read otherwise. Ownership rules (`from`, `where`) cannot be
// checked against a historical event, so a field behind one counts as restricted.

import {
  type EntityDefinition,
  hostRoleAllowsRead,
  normalizeAccessEntry,
  type Registry,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { isDeclaredEntityVerb } from "@cosmicdrift/kumiko-types/fields";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

export type AuditPayloadFilter = (
  aggregateType: string,
  type: string,
  payload: Record<string, unknown>,
) => Record<string, unknown> | null;

const LIFECYCLE_VERBS = ["created", "updated", "deleted", "restored", "forgotten"] as const;

// null: the whole payload is withheld. Otherwise the field names to strip.
type AggregateVisibility = { readonly restrictedFields: ReadonlySet<string> } | null;

function userHoldsUnrestrictedRole(
  accessMap: Readonly<Record<string, unknown>>,
  user: SessionUser,
): boolean {
  return user.roles.some((role) => accessMap[role] === "all");
}

function isReadRestrictedFor(
  read: Parameters<typeof normalizeAccessEntry>[0],
  user: SessionUser,
): boolean {
  const accessMap = normalizeAccessEntry(read);
  return accessMap !== undefined && !userHoldsUnrestrictedRole(accessMap, user);
}

function isRestrictedField(
  field: EntityDefinition["fields"][string],
  user: SessionUser,
): boolean {
  if (field.type === "text" && field.writeOnly === true) return true;
  // An embedded value is withheld as a whole; its sub-fields are not filtered one by one.
  if (
    field.type === "embedded" &&
    Object.values(field.schema).some((sub) => isReadRestrictedFor(sub.access?.read, user))
  ) {
    return true;
  }
  return isReadRestrictedFor(field.access?.read, user);
}

function visibilityOf(
  registry: Registry,
  entity: EntityDefinition,
  aggregateType: string,
  user: SessionUser,
): AggregateVisibility {
  if (!hostRoleAllowsRead(registry, aggregateType, user)) return null;
  if (entity.readGate !== undefined || entity.parentRef !== undefined) return null;
  const readMap = entity.access?.read;
  if (
    readMap !== undefined &&
    Object.keys(readMap).length > 0 &&
    !userHoldsUnrestrictedRole(readMap, user)
  ) {
    return null;
  }
  const restrictedFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if (isRestrictedField(field, user)) restrictedFields.add(name);
  }
  return { restrictedFields };
}

function withoutKeys(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));
}

function stripLifecyclePayload(
  payload: Record<string, unknown>,
  restricted: ReadonlySet<string>,
): Record<string, unknown> {
  const stripped = withoutKeys(payload, restricted);
  for (const nested of ["changes", "previous"] as const) {
    const value = stripped[nested];
    if (isPlainObject(value)) stripped[nested] = withoutKeys(value, restricted);
  }
  return stripped;
}

export function createAuditPayloadFilter(
  registry: Registry,
  user: SessionUser,
): AuditPayloadFilter {
  const visibilityByAggregate = new Map<string, AggregateVisibility | "unrestricted">();

  const visibilityFor = (aggregateType: string): AggregateVisibility | "unrestricted" => {
    const cached = visibilityByAggregate.get(aggregateType);
    if (cached !== undefined) return cached;
    const entity = registry.getEntity(aggregateType);
    const visibility =
      entity === undefined ? "unrestricted" : visibilityOf(registry, entity, aggregateType, user);
    visibilityByAggregate.set(aggregateType, visibility);
    return visibility;
  };

  return (aggregateType, type, payload) => {
    const visibility = visibilityFor(aggregateType);
    if (visibility === "unrestricted") return payload;
    if (visibility === null) return null;
    if (visibility.restrictedFields.size === 0) return payload;
    const isLifecycleEvent =
      LIFECYCLE_VERBS.some((verb) => type === `${aggregateType}.${verb}`) ||
      (type.startsWith(`${aggregateType}.`) &&
        isDeclaredEntityVerb(registry.getEntity(aggregateType), type.slice(aggregateType.length + 1)));
    if (!isLifecycleEvent) return null;
    return stripLifecyclePayload(payload, visibility.restrictedFields);
  };
}
