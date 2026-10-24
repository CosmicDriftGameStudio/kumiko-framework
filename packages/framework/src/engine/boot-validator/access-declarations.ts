import type {
  AccessRule,
  QueryHandlerDef,
  StreamHandlerDef,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-types/handlers";
import { escapeHatchGrantsProblem, isRateLimitDisabled } from "@cosmicdrift/kumiko-types/handlers";
import { reasonProblem } from "../escape-hatch-reason.ts";
import {
  accessAllowsAnonymous,
  declaredPersonalData,
  personalFieldNames,
} from "../personal-data-fields.ts";
import { ANONYMOUS_ROLE } from "../system-user.ts";
import type { FeatureDefinition } from "../types/index.ts";

import { collectZodObjectKeys } from "./zod-shape.ts";

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

// Not an object with a string `reason` (incl. deprecated `openToAll: true`) counts as malformed.
function openToAllReasonOf(access: AccessRule): string | undefined {
  if (!("openToAll" in access)) return undefined;
  const openToAll: unknown = access.openToAll;
  if (typeof openToAll !== "object" || openToAll === null) return "";
  if (!("reason" in openToAll) || typeof openToAll.reason !== "string") return "";
  return openToAll.reason;
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
  const reason = openToAllReasonOf(access);
  // skip: no openToAll declared
  if (reason === undefined) return;
  const problem = reasonProblem(reason);
  // skip: reason is well-formed, nothing to validate
  if (problem === undefined) return;
  throw new Error(
    `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares an invalid ` +
      `{ openToAll: ... } — ${problem}. Must be { reason: "<explanation>" } for why any ` +
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
  if (escapeHatch) {
    const grantsProblem = escapeHatchGrantsProblem(escapeHatch);
    if (grantsProblem !== undefined) {
      throw new Error(
        `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares an invalid escapeHatch — ${grantsProblem}`,
      );
    }
    const problem = reasonProblem(escapeHatch.reason);
    if (problem !== undefined) {
      throw new Error(
        `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares an invalid escapeHatch — ${problem}`,
      );
    }
  }
}

function validatePersonalDataSupportedForKind(
  feature: FeatureDefinition,
  kind: HandlerKind,
  handlerName: string,
  access: AccessRule,
): void {
  // skip: nothing declared
  if (declaredPersonalData(access) === undefined) return;
  // skip: write handlers accept every personalData declaration
  if (kind === "write") return;
  const isOpenToAll = "openToAll" in access;
  // skip: query handlers may declare access.personalData, its value is validated separately
  if (kind === "query" && !isOpenToAll) return;
  const property = isOpenToAll ? "openToAll.personalData" : "access.personalData";
  const onlyAllowed =
    kind === "query"
      ? 'only access.personalData: "public-intake" applies to query handlers, which write ' +
        "personal data through nested writes of an anonymous request."
      : "it only applies to write handlers, whose input is checked for personal-data fields.";
  throw new Error(
    `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares ${property} — ${onlyAllowed} Remove the personalData declaration from this handler.`,
  );
}

function validatePersonalDataValue(
  feature: FeatureDefinition,
  kind: HandlerKind,
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
      `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares an unknown ` +
        `openToAll.personalData ${JSON.stringify(declared)} — the only supported value is "tenant-members".`,
    );
  }
  if (declared !== "public-intake") {
    throw new Error(
      `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares an unknown ` +
        `access.personalData ${JSON.stringify(declared)} — the only supported value is "public-intake".`,
    );
  }
  // skip: roles include "anonymous", which personalData: "public-intake" requires
  if (accessAllowsAnonymous(access)) return;
  throw new Error(
    `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares ` +
      'access.personalData: "public-intake" but its roles do not include ' +
      `"${ANONYMOUS_ROLE}" — personalData: "public-intake" only applies to handlers ` +
      "that allow anonymous callers. Add the anonymous role to access.roles or remove personalData.",
  );
}

function handlerInputKeys(
  feature: FeatureDefinition,
  handlerName: string,
  handler: WriteHandlerDef,
): ReadonlySet<string> {
  try {
    return collectZodObjectKeys(handler.schema);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[Feature ${feature.name}] write handler "${handlerName}": ${reason}`);
  }
}

function validateOpenToAllPersonalData(
  feature: FeatureDefinition,
  handlerName: string,
  handler: WriteHandlerDef,
): void {
  const access = handler.access;
  // skip: no openToAll declared, or the handler declares tenant members may write personal data
  if (!hasOpenToAll(access) || declaresTenantMembersPersonalData(access)) return;
  const inputKeys = handlerInputKeys(feature, handlerName, handler);
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
  const inputKeys = handlerInputKeys(feature, handlerName, handler);
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

// The rateLimit is the only protection of a public-intake handler, so the
// generic anonymous opt-out (rateLimit: { disabled: true }) must not apply.
function validatePublicIntakeRateLimit(
  feature: FeatureDefinition,
  kind: HandlerKind,
  handlerName: string,
  handler: Pick<WriteHandlerDef, "access" | "rateLimit">,
): void {
  // skip: not a public-intake handler
  if (declaredPersonalData(handler.access) !== "public-intake") return;
  // skip: rateLimit is active
  if (!isRateLimitDisabled(handler.rateLimit)) return;
  throw new Error(
    `[Feature ${feature.name}] ${kind} handler "${handlerName}" declares ` +
      'access.personalData: "public-intake" with rateLimit: { disabled: true } — the rateLimit ' +
      'is the only protection for anonymous personal-data writes. Declare rateLimit: { per: "ip" ' +
      'or "ip+handler", ... } instead.',
  );
}

export function validateAccessDeclarations(feature: FeatureDefinition): void {
  for (const [handlerName, handler] of Object.entries(feature.writeHandlers)) {
    validateOpenToAllReason(feature, "write", handlerName, handler.access);
    validateEscapeHatchReason(feature, "write", handlerName, handler.escapeHatch);
    validatePersonalDataValue(feature, "write", handlerName, handler.access);
    validateOpenToAllPersonalData(feature, handlerName, handler);
    validateAnonymousPersonalData(feature, handlerName, handler);
    validatePublicIntakeRateLimit(feature, "write", handlerName, handler);
  }
  for (const [handlerName, handler] of Object.entries(feature.queryHandlers)) {
    validateOpenToAllReason(feature, "query", handlerName, handler.access);
    validateEscapeHatchReason(feature, "query", handlerName, handler.escapeHatch);
    validatePersonalDataSupportedForKind(feature, "query", handlerName, handler.access);
    validatePersonalDataValue(feature, "query", handlerName, handler.access);
    validatePublicIntakeRateLimit(feature, "query", handlerName, handler);
  }
  for (const [handlerName, handler] of Object.entries(feature.streamHandlers)) {
    validateOpenToAllReason(feature, "stream", handlerName, handler.access);
    validateEscapeHatchReason(feature, "stream", handlerName, handler.escapeHatch);
    validatePersonalDataSupportedForKind(feature, "stream", handlerName, handler.access);
  }
}
