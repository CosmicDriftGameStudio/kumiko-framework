import type { ResolvedPiiFlags } from "@cosmicdrift/kumiko-types/fields";
import { type EventPiiSubject, normalizeEventPiiSubject } from "@cosmicdrift/kumiko-types/handlers";
import type { EntityDefinition } from "../engine/types/fields.ts";
import type { TenantId } from "../engine/types/identifiers.ts";
import { isSelfPiiField } from "./is-self-pii-field.ts";
import { RECORD_ENTITY_PATTERN, type SubjectId } from "./kms-adapter.ts";

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
  // The owner the same event sets: an update's `previous` row is still
  // ownerless while the event assigns one.
  readonly ownerFallback?: Record<string, unknown>;
  // Backfill resolves the projection row before falling back to whenAbsent,
  // so it asks for the strict chain first.
  readonly ignoreWhenAbsent?: boolean;
}

export function nonEmptyString(value: unknown): string | null {
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
  userOwned: NonNullable<ResolvedPiiFlags["userOwned"]>,
  fieldName: string,
  row: Record<string, unknown>,
  opts: ResolveSubjectOptions,
): SubjectId {
  const { ownerField } = userOwned;
  const userId =
    nonEmptyString(row[ownerField]) ?? nonEmptyString(opts.ownerFallback?.[ownerField]);
  if (userId !== null) return { kind: "user", userId };
  if (opts.ignoreWhenAbsent !== true) {
    if (userOwned.whenAbsent === "tenant") return resolveTenantSubject(fieldName, row, opts);
    if (userOwned.whenAbsent === "self") return resolveRecordSubject(fieldName, row, opts);
  }
  throw new SubjectResolutionError(
    fieldName,
    `owner field "${ownerField}" is empty on the row and the field declares no whenAbsent — declare { personal: { of: "${ownerField}", whenAbsent: "tenant" } } or whenAbsent: "self" to key it on the row itself (fw#3654)`,
  );
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
    return resolveUserOwnedSubject(field.userOwned, fieldName, row, opts);
  }

  if ("tenantOwned" in field && field.tenantOwned === true) {
    return resolveTenantSubject(fieldName, row, opts);
  }

  if (isSelfPiiField(field)) {
    return resolveSelfPiiSubject(fieldName, row);
  }

  return null;
}

// Envelope facts an event's own aggregate stream always carries — unlike a
// row's tenantId/id columns, these are structural, so a missing/empty value
// here is a caller bug, not a normal "no subject to shred" case.
export interface EventSubjectEnvelope {
  readonly tenantId: TenantId;
  readonly aggregateType: string;
  readonly aggregateId: string;
}

function resolveEnvelopeTenant(fieldName: string, envelope: EventSubjectEnvelope): SubjectId {
  if (nonEmptyString(envelope.tenantId) === null) {
    throw new SubjectResolutionError(fieldName, "event envelope tenantId is empty");
  }
  return { kind: "tenant", tenantId: envelope.tenantId };
}

function resolveEnvelopeRecordSubject(
  fieldName: string,
  envelope: EventSubjectEnvelope,
): SubjectId {
  if (
    nonEmptyString(envelope.aggregateType) === null ||
    nonEmptyString(envelope.aggregateId) === null
  ) {
    throw new SubjectResolutionError(
      fieldName,
      "event envelope aggregateType/aggregateId is empty",
    );
  }
  // aggregate_type is a free-form text column (events-schema.ts) — reject
  // here rather than mint a record key that subjectIdSchema (kms-adapter.ts)
  // would later refuse to shred.
  if (!RECORD_ENTITY_PATTERN.test(envelope.aggregateType)) {
    throw new SubjectResolutionError(
      fieldName,
      `event aggregateType "${envelope.aggregateType}" does not match ${RECORD_ENTITY_PATTERN} — not a shreddable record subject`,
    );
  }
  return { kind: "record", entity: envelope.aggregateType, id: envelope.aggregateId };
}

// Same resolver for the live-append path (encryptEventPayloadPii) and the
// backfill catalog path (backfillEventPiiEncryption) — the reason the two
// can never encrypt the same field under different subjects. A "user"
// subject whose owner field is empty falls back to the declared whenAbsent
// stance and throws when none is declared; "tenant"/"self" throw
// on an empty envelope, since their facts are structural.
export function resolveEventSubject(
  fieldName: string,
  spec: EventPiiSubject,
  payload: Record<string, unknown>,
  envelope: EventSubjectEnvelope,
): SubjectId | null {
  const normalized = normalizeEventPiiSubject(spec);

  if (normalized.kind === "user") {
    const userId = nonEmptyString(payload[normalized.ownerField]);
    if (userId !== null) return { kind: "user", userId };
    if (normalized.whenAbsent === "tenant") return resolveEnvelopeTenant(fieldName, envelope);
    if (normalized.whenAbsent === "self") return resolveEnvelopeRecordSubject(fieldName, envelope);
    if (normalized.whenAbsent === "plaintext") {
      // skip: author declared whenAbsent: "plaintext" — value ships unencrypted by decision
      return null;
    }
    throw new SubjectResolutionError(
      fieldName,
      `owner field "${normalized.ownerField}" carries no id and the event declares no whenAbsent fallback — ` +
        `refusing to append plaintext PII. Declare { personal: { of: "${normalized.ownerField}", ` +
        `whenAbsent: "tenant" } } to encrypt under the envelope tenant key, whenAbsent: "self" to encrypt ` +
        `under the event's own record key, or whenAbsent: "plaintext" ` +
        "to acknowledge that this value cannot be crypto-shredded (fw#2776).",
    );
  }

  if (normalized.kind === "tenant") {
    return resolveEnvelopeTenant(fieldName, envelope);
  }

  if (normalized.kind === "self") {
    return resolveEnvelopeRecordSubject(fieldName, envelope);
  }

  const exhaustiveCheck: never = normalized;
  throw new Error(`Unhandled normalized event PII subject: ${JSON.stringify(exhaustiveCheck)}`);
}

/** True when the field can be keyed on the row's own `record:<entity>:<id>` subject. */
export function isRecordKeyedField(field: EntityDefinition["fields"][string]): boolean {
  if ("recordOwned" in field && field.recordOwned === true) return true;
  return "userOwned" in field && field.userOwned?.whenAbsent === "self";
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

function isFileReferenceField(field: EntityDefinition["fields"][string]): boolean {
  return (
    field.type === "file" ||
    field.type === "image" ||
    field.type === "files" ||
    field.type === "images"
  );
}

// File columns hold only the fileRef uuid; the binary is erased by the file-ref
// user-data hook, so these stay annotated (forget) but are never ciphertext.
export function collectPiiEncryptedFields(entity: EntityDefinition): readonly string[] {
  return Object.entries(entity.fields)
    .filter(([, field]) => hasSubjectAnnotation(field) && !isFileReferenceField(field))
    .map(([name]) => name);
}

// The annotated file-reference fields: never ciphertext today, but events from the
// old backfill (which encrypted them) still carry it and must replay.
export function collectPiiFileReferenceFields(entity: EntityDefinition): readonly string[] {
  return Object.entries(entity.fields)
    .filter(([, field]) => hasSubjectAnnotation(field) && isFileReferenceField(field))
    .map(([name]) => name);
}

/** Subject-annotated fields that may be plaintext in the derived search index. */
export function collectSearchableSubjectFields(entity: EntityDefinition): readonly string[] {
  return Object.entries(entity.fields)
    .filter(([, field]) => {
      if (!hasSubjectAnnotation(field)) return false;
      if ("sensitive" in field && field.sensitive === true) return false;
      return "searchable" in field && field.searchable === true;
    })
    .map(([name]) => name);
}
