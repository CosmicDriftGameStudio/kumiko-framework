import {
  accessAllowsAnonymous,
  declaredPersonalData,
  personalFieldNames,
} from "../personal-data-fields";
import { ANONYMOUS_ROLE } from "../system-user";
import type {
  AccessRule,
  FeatureDefinition,
  QueryHandlerDef,
  StreamHandlerDef,
  WriteHandlerDef,
} from "../types";
import { collectZodObjectKeys } from "./zod-shape";

type HandlerKind = "write" | "query" | "stream";

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
  honorOwnerBindingOverride?: boolean,
): ReadonlySet<string> {
  const mappedEntityName = feature.handlerEntityMappings?.[handlerName];
  const entities = feature.entities ?? {};
  if (mappedEntityName) {
    const entity = entities[mappedEntityName];
    const honorOwnerBinding =
      honorOwnerBindingOverride ?? !canWriteAroundExecutor(feature, handler);
    return entity ? personalFieldNames(entity, honorOwnerBinding) : new Set();
  }
  const names = new Set<string>();
  for (const entity of Object.values(entities)) {
    for (const name of personalFieldNames(entity, false)) names.add(name);
  }
  return names;
}

// Not an object with a non-empty string `reason` (incl. deprecated `openToAll: true`) counts as "empty".
function openToAllReasonIsEmpty(access: AccessRule): boolean {
  if (!("openToAll" in access)) return false;
  const openToAll: unknown = access.openToAll;
  if (typeof openToAll !== "object" || openToAll === null) return true;
  if (!("reason" in openToAll) || typeof openToAll.reason !== "string") return true;
  return openToAll.reason.trim().length === 0;
}

function hasOpenToAll(access: AccessRule): boolean {
  return "openToAll" in access;
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
      '{ openToAll: ... } — must be { reason: "<non-empty explanation>" } for why any ' +
      "authenticated user may call this handler. `{ openToAll: true }` is no longer accepted.",
  );
}

function validateEscapeHatchReason(
  feature: FeatureDefinition,
  kind: HandlerKind,
  handlerName: string,
  escapeHatch:
    | WriteHandlerDef["escapeHatch"]
    | QueryHandlerDef["escapeHatch"]
    | StreamHandlerDef["escapeHatch"],
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
  const property = "openToAll" in access ? "openToAll.personalData" : "access.personalData";
  throw new Error(
    `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares ` +
      `${property} — it only applies to write handlers, whose input is ` +
      "checked for personal-data fields.",
  );
}

function validatePersonalDataValue(
  feature: FeatureDefinition,
  handlerName: string,
  access: AccessRule,
): void {
  const declared = declaredPersonalData(access);
  // skip: nothing declared
  if (declared === undefined) return;
  if ("openToAll" in access) {
    // skip: the one supported value on openToAll
    if (declared === "tenant-members") return;
    throw new Error(
      `[Feature ${feature.name}] write handler "${handlerName}" declares an unknown ` +
        `openToAll.personalData ${JSON.stringify(declared)} — the only supported value is "tenant-members".`,
    );
  }
  if (declared !== "public-intake") {
    throw new Error(
      `[Feature ${feature.name}] write handler "${handlerName}" declares an unknown ` +
        `access.personalData ${JSON.stringify(declared)} — the only supported value is "public-intake".`,
    );
  }
  // skip: roles include "anonymous", which personalData: "public-intake" requires
  if (Array.isArray(access.roles) && access.roles.includes(ANONYMOUS_ROLE)) return;
  throw new Error(
    `[Feature ${feature.name}] write handler "${handlerName}" declares ` +
      'access.personalData: "public-intake" but its roles do not include ' +
      `"${ANONYMOUS_ROLE}" — personalData: "public-intake" only applies to handlers ` +
      "that allow anonymous callers.",
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

// Anonymous callers all share one user.id, so honorOwnerBindingOverride is always false here.
function validateAnonymousPersonalData(
  feature: FeatureDefinition,
  handlerName: string,
  handler: WriteHandlerDef,
): void {
  const access = handler.access;
  // skip: not reachable by an anonymous caller, or already declares public-intake
  if (!accessAllowsAnonymous(access) || declaredPersonalData(access) === "public-intake") return;
  const inputKeys = collectZodObjectKeys(handler.schema);
  const personalNames = candidatePersonalFieldNames(feature, handlerName, handler, false);
  const offending = [...inputKeys].filter((key) => personalNames.has(key));
  // skip: no personal-data fields in the handler's input
  if (offending.length === 0) return;
  throw new Error(
    `[Feature ${feature.name}] write handler "${handlerName}" allows anonymous callers ` +
      `("${ANONYMOUS_ROLE}" in access.roles) and accepts personal-data field(s) ` +
      `${offending.map((f) => `"${f}"`).join(", ")}. Declare ` +
      'access: { roles: [..., "anonymous"], personalData: "public-intake" } — every anonymous ' +
      'request shares one caller identity, so owner-binding via from("user:id", ...) does not ' +
      "vouch for it; protection comes from the handler's required rateLimit (per ip).",
  );
}

export function validateAccessDeclarations(feature: FeatureDefinition): void {
  for (const [handlerName, handler] of Object.entries(feature.writeHandlers)) {
    validateOpenToAllReason(feature, "write", handlerName, handler.access);
    validateEscapeHatchReason(feature, "write", handlerName, handler.escapeHatch);
    validatePersonalDataValue(feature, handlerName, handler.access);
    validateOpenToAllPersonalData(feature, handlerName, handler);
    validateAnonymousPersonalData(feature, handlerName, handler);
  }
  for (const [handlerName, handler] of Object.entries(feature.queryHandlers)) {
    validateOpenToAllReason(feature, "query", handlerName, handler.access);
    validateEscapeHatchReason(feature, "query", handlerName, handler.escapeHatch);
    validatePersonalDataOnlyOnWrite(feature, "query", handlerName, handler.access);
  }
  for (const [handlerName, handler] of Object.entries(feature.streamHandlers)) {
    validateOpenToAllReason(feature, "stream", handlerName, handler.access);
    validateEscapeHatchReason(feature, "stream", handlerName, handler.escapeHatch);
    validatePersonalDataOnlyOnWrite(feature, "stream", handlerName, handler.access);
  }
}
