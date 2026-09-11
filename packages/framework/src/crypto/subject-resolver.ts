import type { EntityDefinition } from "../engine/types/fields";
import type { TenantId } from "../engine/types/identifiers";
import { isSelfPiiField } from "./is-self-pii-field";
import type { SubjectId } from "./kms-adapter";

// Thrown when a field IS pii-annotated but the row can't name its subject —
// that must surface as an error, not fall back to plaintext.
export class SubjectResolutionError extends Error {
  constructor(
    public readonly fieldName: string,
    reason: string,
  ) {
    super(`Cannot resolve PII subject for field "${fieldName}": ${reason}`);
    this.name = "SubjectResolutionError";
  }
}

export interface ResolveSubjectOptions {
  // Write-time tenant scope — consulted for tenantOwned fields when the row
  // itself carries no tenantId column.
  readonly tenantId?: TenantId;
  // Canonical source is the registry entity name (executor `entityName` /
  // event `aggregate_type`) — required to resolve recordOwned fields.
  readonly entityName: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rowIdAsString(row: Record<string, unknown>): string | null {
  const id = row["id"];
  return nonEmptyString(id) ?? (typeof id === "number" ? String(id) : null);
}

function resolveRecordSubject(
  fieldName: string,
  row: Record<string, unknown>,
  opts: ResolveSubjectOptions,
): SubjectId {
  const entityName = nonEmptyString(opts.entityName);
  if (entityName === null) {
    throw new SubjectResolutionError(
      fieldName,
      "record subject needs the entity name; caller did not supply one",
    );
  }
  const recordId = rowIdAsString(row);
  if (recordId === null) {
    throw new SubjectResolutionError(fieldName, "row has no id to use as the record subject");
  }
  return { kind: "record", entity: entityName, id: recordId };
}

function resolveUserOwnedSubject(
  ownerField: string,
  fieldName: string,
  row: Record<string, unknown>,
): SubjectId {
  const userId = nonEmptyString(row[ownerField]);
  if (userId === null) {
    throw new SubjectResolutionError(fieldName, `owner field "${ownerField}" is empty on the row`);
  }
  return { kind: "user", userId };
}

function resolveTenantSubject(
  fieldName: string,
  row: Record<string, unknown>,
  opts: ResolveSubjectOptions,
): SubjectId {
  const tenantId = nonEmptyString(row["tenantId"]) ?? opts.tenantId;
  if (tenantId === undefined) {
    throw new SubjectResolutionError(
      fieldName,
      "row has no tenantId column and no write-time tenantId was provided",
    );
  }
  return { kind: "tenant", tenantId };
}

function resolveSelfPiiSubject(fieldName: string, row: Record<string, unknown>): SubjectId {
  // pii: true = the entity itself is the subject (user.email belongs to
  // that user row). Serial ids are stringified — subject keys are text.
  const userId = rowIdAsString(row);
  if (userId === null) {
    throw new SubjectResolutionError(fieldName, "row has no id to use as the pii self-subject");
  }
  return { kind: "user", userId };
}

/**
 * Maps a pii-annotated field to the subject whose key encrypts it.
 * Returns null for fields without any PII annotation (stored plaintext).
 *
 * Precedence for multi-annotated fields mirrors the erase triggers:
 * recordOwned (record-forget) > userOwned (user-forget) > tenantOwned
 * (tenant-destroy) > pii (self).
 */
export function resolveSubjectForField(
  entity: EntityDefinition,
  fieldName: string,
  row: Record<string, unknown>,
  opts: ResolveSubjectOptions,
): SubjectId | null {
  const field = entity.fields[fieldName];
  if (!field) throw new SubjectResolutionError(fieldName, "field is not defined on the entity");

  if ("recordOwned" in field && field.recordOwned === true) {
    return resolveRecordSubject(fieldName, row, opts);
  }

  if ("userOwned" in field && field.userOwned !== undefined) {
    return resolveUserOwnedSubject(field.userOwned.ownerField, fieldName, row);
  }

  if ("tenantOwned" in field && field.tenantOwned === true) {
    return resolveTenantSubject(fieldName, row, opts);
  }

  if (isSelfPiiField(field)) {
    return resolveSelfPiiSubject(fieldName, row);
  }

  return null;
}

function hasSubjectAnnotation(field: EntityDefinition["fields"][string]): boolean {
  return (
    ("userOwned" in field && field.userOwned !== undefined) ||
    ("tenantOwned" in field && field.tenantOwned === true) ||
    ("recordOwned" in field && field.recordOwned === true) ||
    isSelfPiiField(field)
  );
}

// The field names an encrypt engine must process for an entity — precomputed
// once at executor build time, like the sensitiveFields set.
export function collectPiiSubjectFields(entity: EntityDefinition): readonly string[] {
  return Object.entries(entity.fields)
    .filter(([, field]) => hasSubjectAnnotation(field))
    .map(([name]) => name);
}

/** Subject-annotated fields that may be plaintext in the derived search index (#1610). */
export function collectSearchableSubjectFields(entity: EntityDefinition): readonly string[] {
  return Object.entries(entity.fields)
    .filter(([, field]) => {
      if (!hasSubjectAnnotation(field)) return false;
      if ("sensitive" in field && field.sensitive === true) return false;
      return "searchable" in field && field.searchable === true;
    })
    .map(([name]) => name);
}
