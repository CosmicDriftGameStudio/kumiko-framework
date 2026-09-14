import type {
  AccessRule,
  FeatureDefinition,
  OwnershipMap,
  OwnershipRule,
  QueryHandlerDef,
  WriteHandlerDef,
} from "../types";
import type { EntityDefinition, ResolvedPiiFlags } from "../types/fields";
import { collectZodObjectKeys } from "./zod-shape";

type HandlerKind = "write" | "query" | "stream";

// Personal-data annotation check mirrors pii-retention.ts's hasAnonymizableSubjectField,
// minus tenantOwned: a tenant-scoped field isn't an individual's personal data in the
// sense the openToAll personal-data check is guarding against.
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

function personalFieldNames(
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

// escapeHatch and r.systemScope() can write around the entity's write map
// (db.global(), systemDb, SYSTEM identity), so the map no longer vouches for the row.
function canWriteAroundExecutor(feature: FeatureDefinition, handler: WriteHandlerDef): boolean {
  return handler.escapeHatch !== undefined || feature.systemScope;
}

// Owner binding counts only for a handler mapped to one entity.
function candidatePersonalFieldNames(
  feature: FeatureDefinition,
  handlerName: string,
  handler: WriteHandlerDef,
): ReadonlySet<string> {
  const mappedEntityName = feature.handlerEntityMappings?.[handlerName];
  const entities = feature.entities ?? {};
  if (mappedEntityName) {
    const entity = entities[mappedEntityName];
    const honorOwnerBinding = !canWriteAroundExecutor(feature, handler);
    return entity ? personalFieldNames(entity, honorOwnerBinding) : new Set();
  }
  const names = new Set<string>();
  for (const entity of Object.values(entities)) {
    for (const name of personalFieldNames(entity, false)) names.add(name);
  }
  return names;
}

// A value that is neither `true` nor an object with a non-empty string `reason`
// counts as "empty" — catches malformed openToAll from untyped sources too.
function openToAllReasonIsEmpty(access: AccessRule): boolean {
  if (!("openToAll" in access)) return false;
  const openToAll: unknown = access.openToAll;
  if (openToAll === true) return false;
  if (typeof openToAll !== "object" || openToAll === null) return true;
  if (!("reason" in openToAll) || typeof openToAll.reason !== "string") return true;
  return openToAll.reason.trim().length === 0;
}

function hasOpenToAll(access: AccessRule): boolean {
  return "openToAll" in access;
}

// Read via `unknown`: access can come from untyped sources (pattern JSON, Designer).
function declaredPersonalData(access: AccessRule): unknown {
  if (!("openToAll" in access)) return undefined;
  const openToAll: unknown = access.openToAll;
  if (typeof openToAll !== "object" || openToAll === null) return undefined;
  return "personalData" in openToAll ? openToAll.personalData : undefined;
}

function declaresTenantMembersPersonalData(access: AccessRule): boolean {
  return declaredPersonalData(access) === "tenant-members";
}

function validateOpenToAllReason(
  feature: FeatureDefinition,
  kind: HandlerKind,
  handlerName: string,
  access: AccessRule,
): void {
  // skip: reason is well-formed, nothing to validate
  if (!openToAllReasonIsEmpty(access)) return;
  throw new Error(
    `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares an invalid ` +
      '{ openToAll: ... } — must be `true` or { reason: "<non-empty explanation>" } ' +
      "for why any authenticated user may call this handler.",
  );
}

function validateEscapeHatchReason(
  feature: FeatureDefinition,
  kind: HandlerKind,
  handlerName: string,
  escapeHatch: WriteHandlerDef["escapeHatch"] | QueryHandlerDef["escapeHatch"],
): void {
  // skip: no escapeHatch declared, or its reason is already non-empty
  if (!escapeHatch || escapeHatch.reason.trim().length > 0) return;
  throw new Error(
    `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares ` +
      `{ escapeHatch: { reason: "" } } — the reason must be a non-empty string ` +
      "explaining why this handler needs db.global() write access or a SYSTEM identity switch.",
  );
}

function validatePersonalDataOnlyOnWrite(
  feature: FeatureDefinition,
  kind: HandlerKind,
  handlerName: string,
  access: AccessRule,
): void {
  // skip: write handlers may declare personalData, or it wasn't declared here
  if (kind === "write" || declaredPersonalData(access) === undefined) return;
  throw new Error(
    `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares ` +
      "openToAll.personalData — it only applies to write handlers, whose input is " +
      "checked for personal-data fields.",
  );
}

function validatePersonalDataValue(
  feature: FeatureDefinition,
  handlerName: string,
  access: AccessRule,
): void {
  const declared = declaredPersonalData(access);
  // skip: nothing declared, or the one supported value
  if (declared === undefined || declared === "tenant-members") return;
  throw new Error(
    `[Feature ${feature.name}] write handler "${handlerName}" declares an unknown ` +
      `openToAll.personalData ${JSON.stringify(declared)} — the only supported value is "tenant-members".`,
  );
}

function validateOpenToAllPersonalData(
  feature: FeatureDefinition,
  handlerName: string,
  handler: WriteHandlerDef,
): void {
  const access = handler.access;
  // skip: no openToAll declared, or the handler declares tenant members may write personal data
  if (!hasOpenToAll(access) || declaresTenantMembersPersonalData(access)) return;
  const inputKeys = collectZodObjectKeys(handler.schema);
  const personalNames = candidatePersonalFieldNames(feature, handlerName, handler);
  const offending = [...inputKeys].filter((key) => personalNames.has(key));
  // skip: no personal-data fields in the handler's input
  if (offending.length === 0) return;
  throw new Error(
    `[Feature ${feature.name}] write handler "${handlerName}" declares openToAll and ` +
      `accepts personal-data field(s) ${offending.map((f) => `"${f}"`).join(", ")} that are ` +
      "not bound to the caller. Choose one: (1) bind rows to the caller — every role in the " +
      'entity\'s access.write is from("user:id", "<ownerField>") for a personal: { of: "<ownerField>" } ' +
      'field, or from("user:id", "id") for a personal: "self" field, with no escapeHatch on the ' +
      "handler and no r.systemScope() on its feature; (2) restrict access to roles; (3) declare " +
      '{ openToAll: { reason: "<why any signed-in tenant member may write this personal data>", ' +
      'personalData: "tenant-members" } }.',
  );
}

export function validateAccessDeclarations(feature: FeatureDefinition): void {
  for (const [handlerName, handler] of Object.entries(feature.writeHandlers)) {
    validateOpenToAllReason(feature, "write", handlerName, handler.access);
    validateEscapeHatchReason(feature, "write", handlerName, handler.escapeHatch);
    validatePersonalDataValue(feature, handlerName, handler.access);
    validateOpenToAllPersonalData(feature, handlerName, handler);
  }
  for (const [handlerName, handler] of Object.entries(feature.queryHandlers)) {
    validateOpenToAllReason(feature, "query", handlerName, handler.access);
    validateEscapeHatchReason(feature, "query", handlerName, handler.escapeHatch);
    validatePersonalDataOnlyOnWrite(feature, "query", handlerName, handler.access);
  }
  for (const [handlerName, handler] of Object.entries(feature.streamHandlers)) {
    validateOpenToAllReason(feature, "stream", handlerName, handler.access);
    validatePersonalDataOnlyOnWrite(feature, "stream", handlerName, handler.access);
  }
}
