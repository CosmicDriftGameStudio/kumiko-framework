import type { AccessRule, FeatureDefinition, QueryHandlerDef, WriteHandlerDef } from "../types";
import type { EntityDefinition, ResolvedPiiFlags } from "../types/fields";
import { getZodObjectShape } from "./zod-shape";

type HandlerKind = "write" | "query" | "stream";

// Personal-data annotation check mirrors pii-retention.ts's hasAnonymizableSubjectField,
// minus tenantOwned: a tenant-scoped field isn't an individual's personal data in the
// sense openToAll+publicIntake is guarding against.
function isPersonalDataField(field: unknown): boolean {
  const annot = field as ResolvedPiiFlags; // @cast-boundary schema-walk — see pii-retention.ts
  return Boolean(annot.pii || annot.userOwned || annot.recordOwned);
}

function personalFieldNames(entity: EntityDefinition): ReadonlySet<string> {
  const names = new Set<string>();
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    if (isPersonalDataField(field)) names.add(fieldName);
  }
  return names;
}

function candidatePersonalFieldNames(
  feature: FeatureDefinition,
  handlerName: string,
): ReadonlySet<string> {
  const mappedEntityName = feature.handlerEntityMappings?.[handlerName];
  const entities = feature.entities ?? {};
  if (mappedEntityName) {
    const entity = entities[mappedEntityName];
    return entity ? personalFieldNames(entity) : new Set();
  }
  const names = new Set<string>();
  for (const entity of Object.values(entities)) {
    for (const name of personalFieldNames(entity)) names.add(name);
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

function hasPublicIntake(access: AccessRule): boolean {
  return "publicIntake" in access && access.publicIntake === true;
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

function validatePublicIntakeOnlyOnWrite(
  feature: FeatureDefinition,
  kind: HandlerKind,
  handlerName: string,
  access: AccessRule,
): void {
  // skip: write handlers may declare publicIntake, or it wasn't declared here
  if (kind === "write" || !hasPublicIntake(access)) return;
  throw new Error(
    `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares ` +
      "{ publicIntake: true } — publicIntake is only meaningful on a write handler " +
      "(it silences the personal-data + openToAll boot check for the fields a write " +
      "handler's input accepts).",
  );
}

function validateOpenToAllPersonalData(
  feature: FeatureDefinition,
  handlerName: string,
  handler: WriteHandlerDef,
): void {
  const access = handler.access;
  // skip: no openToAll declared, or publicIntake already covers personal data
  if (!hasOpenToAll(access) || hasPublicIntake(access)) return;
  const shape = getZodObjectShape(handler.schema);
  // skip: handler schema isn't a zod object — nothing to inspect
  if (!shape) return;
  const personalNames = candidatePersonalFieldNames(feature, handlerName);
  const offending = Object.keys(shape).filter((key) => personalNames.has(key));
  // skip: no personal-data fields in the handler's input
  if (offending.length === 0) return;
  throw new Error(
    `[Feature ${feature.name}] write handler "${handlerName}" declares openToAll and ` +
      `accepts personal-data field(s) ${offending.map((f) => `"${f}"`).join(", ")} without ` +
      "{ publicIntake: true }. Restrict access to roles, or declare " +
      "{ publicIntake: true } if any authenticated user may submit this personal data.",
  );
}

export function validateAccessDeclarations(feature: FeatureDefinition): void {
  for (const [handlerName, handler] of Object.entries(feature.writeHandlers)) {
    validateOpenToAllReason(feature, "write", handlerName, handler.access);
    validateEscapeHatchReason(feature, "write", handlerName, handler.escapeHatch);
    validateOpenToAllPersonalData(feature, handlerName, handler);
  }
  for (const [handlerName, handler] of Object.entries(feature.queryHandlers)) {
    validateOpenToAllReason(feature, "query", handlerName, handler.access);
    validateEscapeHatchReason(feature, "query", handlerName, handler.escapeHatch);
    validatePublicIntakeOnlyOnWrite(feature, "query", handlerName, handler.access);
  }
  for (const [handlerName, handler] of Object.entries(feature.streamHandlers)) {
    validateOpenToAllReason(feature, "stream", handlerName, handler.access);
    validatePublicIntakeOnlyOnWrite(feature, "stream", handlerName, handler.access);
  }
}
