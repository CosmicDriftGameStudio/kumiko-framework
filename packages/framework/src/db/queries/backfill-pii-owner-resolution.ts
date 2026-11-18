import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { SubjectId } from "../../crypto/kms-adapter.ts";
import {
  type ResolveSubjectOptions,
  resolveSubjectForField,
  SubjectResolutionError,
} from "../../crypto/subject-resolver.ts";
import type { TenantId } from "../../engine/types/index.ts";
import { toSnakeCase } from "../table-builder.ts";

export type OwnerSubjectResolution =
  | { readonly kind: "unannotated" }
  | { readonly kind: "unresolved"; readonly error: SubjectResolutionError }
  | { readonly kind: "resolved"; readonly subject: SubjectId; readonly viaProjection: boolean };

type SubjectAttempt =
  | { readonly ok: true; readonly subject: SubjectId | null }
  | { readonly ok: false; readonly error: SubjectResolutionError };

function attemptResolve(
  entity: EntityDefinition,
  field: string,
  source: Record<string, unknown>,
  opts: ResolveSubjectOptions,
): SubjectAttempt {
  try {
    return { ok: true, subject: resolveSubjectForField(entity, field, source, opts) };
  } catch (e) {
    if (!(e instanceof SubjectResolutionError)) throw e;
    return { ok: false, error: e };
  }
}

// An explicit owner key (even null) means the event itself knows the row had no
// owner then; only a missing key predates the owner field and may use the
// projection's current owner.
function payloadNamesOwnerKey(
  entity: EntityDefinition,
  field: string,
  subjectSource: Record<string, unknown>,
  ownerFallback: Record<string, unknown> | undefined,
): boolean {
  const fieldDef = entity.fields[field];
  if (fieldDef === undefined || !("userOwned" in fieldDef) || !fieldDef.userOwned) return false;
  const { ownerField } = fieldDef.userOwned;
  return (
    Object.hasOwn(subjectSource, ownerField) ||
    (ownerFallback !== undefined && Object.hasOwn(ownerFallback, ownerField))
  );
}

// Stage 1 (payload) and stage 2 (projection row, when supplied) resolve the
// owner strictly, ignoring whenAbsent — an ownerless payload must not shadow
// an owner the projection knows. Stage 2b then applies whenAbsent to the
// payload. Stage 3 (erase) is the caller's call, made from "unresolved".
export function resolveOwnerSubject(
  entity: EntityDefinition,
  field: string,
  subjectSource: Record<string, unknown>,
  ownerFallback: Record<string, unknown> | undefined,
  projectionOwnerRow: Record<string, unknown> | undefined,
  tenantId: TenantId,
  entityName: string,
): OwnerSubjectResolution {
  const baseOpts = { tenantId, entityName, ...(ownerFallback && { ownerFallback }) };
  const strictOpts = { ...baseOpts, ignoreWhenAbsent: true };

  const payloadAttempt = attemptResolve(entity, field, subjectSource, strictOpts);
  if (payloadAttempt.ok) {
    return payloadAttempt.subject === null
      ? { kind: "unannotated" }
      : { kind: "resolved", subject: payloadAttempt.subject, viaProjection: false };
  }

  if (projectionOwnerRow && !payloadNamesOwnerKey(entity, field, subjectSource, ownerFallback)) {
    const augmented = { ...subjectSource, ...projectionOwnerRow };
    const projectionAttempt = attemptResolve(entity, field, augmented, strictOpts);
    if (projectionAttempt.ok && projectionAttempt.subject !== null) {
      return { kind: "resolved", subject: projectionAttempt.subject, viaProjection: true };
    }
  }

  const whenAbsentAttempt = attemptResolve(entity, field, subjectSource, baseOpts);
  if (whenAbsentAttempt.ok && whenAbsentAttempt.subject !== null) {
    return { kind: "resolved", subject: whenAbsentAttempt.subject, viaProjection: false };
  }
  return { kind: "unresolved", error: payloadAttempt.error };
}

// Projection columns are snake_case (author_id); event-payload/subject
// fields are camelCase (authorId) — forward-map from entity.fields like
// reindexEntity's rowToState, so any owner field resolves generically
// instead of hand-listing column names per entity.
export function projectionRowToCamel(
  entity: EntityDefinition,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const camel: Record<string, unknown> = {};
  for (const fieldName of Object.keys(entity.fields)) {
    const snake = toSnakeCase(fieldName);
    if (Object.hasOwn(row, snake)) camel[fieldName] = row[snake];
  }
  return camel;
}
