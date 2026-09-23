import { ANONYMOUS_ROLE } from "./system-user";
import type { AccessRule, OwnershipMap, OwnershipRule } from "./types";
import type { EntityDefinition, ResolvedPiiFlags } from "./types/fields";

// Personal-data annotation check mirrors pii-retention.ts's hasAnonymizableSubjectField,
// minus tenantOwned: a tenant-scoped field isn't an individual's personal data in the
// sense the openToAll / public-intake personal-data checks are guarding against.
function isPersonalDataField(field: unknown): boolean {
  const annot = field as ResolvedPiiFlags; // @cast-boundary schema-walk — see pii-retention.ts
  return Boolean(annot.pii || annot.userOwned || annot.recordOwned);
}

function isCallerIdRuleOn(rule: OwnershipRule, column: string): boolean {
  if (rule === "all" || rule.kind !== "from") return false;
  return rule.refKind === "user" && rule.refPath === "id" && rule.column === column;
}

// The executor checks access.write against every created/updated row; one "all" role
// or an empty map (= public) lets a caller write rows owned by someone else.
function writeMapBindsRowsToCaller(
  writeMap: OwnershipMap | undefined,
  ownerColumn: string,
): boolean {
  const rules = Object.values(writeMap ?? {});
  return rules.length > 0 && rules.every((rule) => isCallerIdRuleOn(rule, ownerColumn));
}

const ROW_ID_COLUMN = "id";

// A self/record-owned field's subject is the row itself, so only from("user:id", "id")
// makes that row the caller — on any other entity "self" names a third party.
function callerBindingColumn(annot: ResolvedPiiFlags): string | undefined {
  if (annot.userOwned) return annot.userOwned.ownerField;
  if (annot.pii || annot.recordOwned) return ROW_ID_COLUMN;
  return undefined;
}

function isOwnerBoundField(field: unknown, entity: EntityDefinition): boolean {
  const column = callerBindingColumn(field as ResolvedPiiFlags); // @cast-boundary schema-walk — see pii-retention.ts
  return column !== undefined && writeMapBindsRowsToCaller(entity.access?.write, column);
}

export function personalFieldNames(
  entity: EntityDefinition,
  honorOwnerBinding: boolean,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    const exempt = honorOwnerBinding && isOwnerBoundField(field, entity);
    if (isPersonalDataField(field) && !exempt) names.add(fieldName);
  }
  return names;
}

// Read via `unknown`: access can come from untyped sources (pattern JSON, Designer).
export function declaredPersonalData(access: AccessRule): unknown {
  if (!("openToAll" in access)) return access.personalData;
  const openToAll: unknown = access.openToAll;
  if (typeof openToAll !== "object" || openToAll === null) return undefined;
  return "personalData" in openToAll ? openToAll.personalData : undefined;
}

export function accessAllowsAnonymous(access: AccessRule): boolean {
  if ("openToAll" in access) return false;
  return Array.isArray(access.roles) && access.roles.includes(ANONYMOUS_ROLE);
}
